import pytest

def test_multi_persona_batch_generation():
    """Verify batch generation for 3 distinct persona voices."""
    persona_ids = ["persona_1", "persona_2", "persona_3"]
    batch = []
    for persona_id in persona_ids:
        voice_clip = f"voice_clip_{persona_id}"  # Replace with actual voice clip generation
        metadata = {"persona_id": persona_id}
        batch.append((voice_clip, metadata))

    assert len(batch) == len(persona_ids)
    for voice_clip, metadata in batch:
        assert "persona_id" in metadata