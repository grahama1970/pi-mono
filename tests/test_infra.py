"""Tests for SharedLoRA infrastructure.

These tests require the tts_train package (from .pi/skills/tts-train).
Skipped when run from pi-mono root where tts_train is not installed.
"""
import pytest

try:
    import tts_train  # noqa: F401
    _HAS_TTS_TRAIN = True
except ImportError:
    _HAS_TTS_TRAIN = False

pytestmark = pytest.mark.skipif(not _HAS_TTS_TRAIN, reason="tts_train not installed")


@pytest.mark.skipif(not _HAS_TTS_TRAIN, reason="tts_train not installed")
def test_shared_lora_initialization():
    """Verify SharedLoRAConfig correctly initializes for Qwen3 architecture."""
    from tts_train.infra import SharedLoRAConfig
    
    # Test with valid parameters (subspace_rank >= pseudo_rank required)
    config = SharedLoRAConfig(rank=16, subspace_rank=32)
    assert config.rank == 16
    assert config.subspace_rank == 32
    assert config.pseudo_rank == 8  # default
    
    # Test custom pseudo_rank
    config2 = SharedLoRAConfig(rank=16, subspace_rank=32, pseudo_rank=4)
    assert config2.subspace_rank == 32
    assert config2.pseudo_rank == 4


def test_shared_lora_qwen3_presets():
    """Verify Qwen3-TTS preset configurations."""
    from tts_train.infra import SharedLoRAConfig
    
    config_0_6b = SharedLoRAConfig.for_qwen3_0_6b()
    assert config_0_6b.qwen3_hidden_size == 1536
    
    config_1_7b = SharedLoRAConfig.for_qwen3_1_7b()
    assert config_1_7b.qwen3_hidden_size == 2048


def test_shared_lora_validation():
    """Verify validation catches invalid configurations."""
    from tts_train.infra import SharedLoRAConfig
    
    # subspace_rank must be >= pseudo_rank
    with pytest.raises(ValueError, match="subspace_rank.*must be >= pseudo_rank"):
        SharedLoRAConfig(rank=16, subspace_rank=4, pseudo_rank=8)
    
    # rank must be positive
    with pytest.raises(ValueError, match="must be positive"):
        SharedLoRAConfig(rank=0, subspace_rank=32)


def test_shared_lora_subspace_creation():
    """Verify SharedLoRASubspace can be created and has correct structure."""
    import torch
    from tts_train.infra import SharedLoRAConfig, SharedLoRASubspace
    
    config = SharedLoRAConfig(rank=16, subspace_rank=32, pseudo_rank=8)
    subspace = SharedLoRASubspace(
        in_features=1536,
        out_features=1536,
        config=config,
    )
    
    assert subspace.in_features == 1536
    assert subspace.out_features == 1536
    assert subspace.A_s.shape == (1536, 32)  # (out_features, subspace_rank)
    assert subspace.B_s.shape == (32, 1536)  # (subspace_rank, in_features)
    
    # Shared basis should be frozen
    assert not subspace.A_s.requires_grad
    assert not subspace.B_s.requires_grad


def test_shared_lora_storage_savings():
    """Verify storage savings calculation is correct."""
    import torch
    from tts_train.infra import SharedLoRAConfig, SharedLoRASubspace
    
    config = SharedLoRAConfig(rank=16, subspace_rank=32, pseudo_rank=8)
    subspace = SharedLoRASubspace(
        in_features=1536,
        out_features=1536,
        config=config,
    )
    
    storage = subspace.get_storage_bytes()
    
    # Shared: A_s (1536×32) + B_s (32×1536) = 98,304 elements
    # At 4 bytes (float32): 393,216 bytes
    assert storage["shared"] == 1536 * 32 * 4 + 32 * 1536 * 4
    
    # Per persona: C_t (p×p) = (8×8) = 64 elements = 256 bytes
    assert storage["per_persona"] == 8 * 8 * 4
    
    # Savings ratio for 200 personas should be significant
    ratio = subspace.storage_savings_ratio(200)
    assert ratio < 0.1  # Share should use <10% of standard LoRA storage


def test_shared_lora_persona_workflow():
    """Test full persona addition workflow."""
    import torch
    from tts_train.infra import SharedLoRAConfig, SharedLoRASubspace
    
    config = SharedLoRAConfig(rank=16, subspace_rank=32, pseudo_rank=8)
    subspace = SharedLoRASubspace(
        in_features=1536,
        out_features=1536,
        config=config,
    )
    
    # Initialize with first persona
    lora_A = torch.randn(1536, 16)
    lora_B = torch.randn(16, 1536)
    subspace.initialize_from_lora(lora_A, lora_B, persona_id="horus")
    
    assert subspace._initialized
    assert "horus" in subspace.task_coeffs
    assert subspace.task_coeffs["horus"].shape == (8, 8)  # (pseudo_rank, pseudo_rank)
    
    # Add second persona
    lora_A2 = torch.randn(1536, 16)
    lora_B2 = torch.randn(16, 1536)
    subspace.add_persona(lora_A2, lora_B2, persona_id="erebus")
    
    assert "erebus" in subspace.task_coeffs
    assert subspace.task_coeffs["erebus"].shape == (8, 8)
    
    # Task coefficients should be trainable
    assert subspace.task_coeffs["horus"].requires_grad
    assert subspace.task_coeffs["erebus"].requires_grad
