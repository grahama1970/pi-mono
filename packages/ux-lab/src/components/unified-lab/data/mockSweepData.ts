export interface SweepTrial {
	id: string;
	model: string;
	lr: number;
	epochs: number;
	batch: number;
	f1: number;
	status: "pass" | "fail" | "running";
	isBest: boolean;
	reasoning: string;
}

export const F1_THRESHOLD = 0.82;

export const mockSweepData: SweepTrial[] = [
	{
		id: "trial-001",
		model: "qwen3:1.7b",
		lr: 0.0003,
		epochs: 5,
		batch: 16,
		f1: 0.87,
		status: "pass",
		isBest: true,
		reasoning: "Best F1 at 0.87 with moderate LR. Small model converges fast. Recommended for production deployment.",
	},
	{
		id: "trial-002",
		model: "qwen2.5-coder:7b",
		lr: 0.0001,
		epochs: 10,
		batch: 8,
		f1: 0.84,
		status: "pass",
		isBest: false,
		reasoning: "Larger model achieves 0.84 F1 but requires 2x epochs. Diminishing returns above epoch 8.",
	},
	{
		id: "trial-003",
		model: "DeepSeek-V3",
		lr: 0.001,
		epochs: 3,
		batch: 32,
		f1: 0.72,
		status: "fail",
		isBest: false,
		reasoning: "High LR caused unstable training. Loss oscillated after epoch 2. Reduce LR to 3e-4.",
	},
	{
		id: "trial-004",
		model: "qwen3:1.7b",
		lr: 0.0005,
		epochs: 8,
		batch: 16,
		f1: 0.79,
		status: "fail",
		isBest: false,
		reasoning: "Overfitting detected at epoch 6. Validation loss diverged. Try dropout=0.2 or reduce epochs.",
	},
	{
		id: "trial-005",
		model: "qwen2.5-coder:7b",
		lr: 0.0002,
		epochs: 7,
		batch: 12,
		f1: 0.83,
		status: "running",
		isBest: false,
		reasoning: "Currently training. Epoch 5/7 complete. Tracking loss at 0.31, validation F1 trending up.",
	},
];
