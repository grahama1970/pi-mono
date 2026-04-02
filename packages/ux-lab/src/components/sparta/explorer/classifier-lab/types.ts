// Classifier Lab shared types and constants

export interface Project {
	id: string;
	name: string;
	modality: string;
	status: string;
	f1?: number;
	samples: number;
	classes: number;
}

export interface TrainingRow {
	rank: number;
	backbone: string;
	lr: string;
	bs: number;
	f1: number;
	acc: number;
	latency: string;
	cost: string;
	status: "pass" | "fail" | "training" | "queued";
	progress?: number;
}

export interface FailureRound {
	round: number;
	strategy: string;
	backbone: string;
	f1: number;
	accuracy: number;
	diagnosis: string | null;
	errors: string[] | null;
	hps: Record<string, unknown> | null;
}

export interface NextSteps {
	best_backbone: string;
	best_f1: number;
	gate_threshold: number;
	gap: number;
	total_rounds: number;
	plateau_detected: boolean;
	diagnosis: string;
	strategies_exhausted: string[];
	dogpile_hypotheses: string;
	timestamp: string;
}

export interface FailureAnalysis {
	projectId: string;
	totalRounds: number;
	bestF1: number;
	strategiesTried: string[];
	lastDiagnosis: string | null;
	rounds: FailureRound[];
	dogpileInsights: Array<{ round: number; phase: string; query: string }>;
	researchMd: string;
	nextSteps: NextSteps | null;
}

export interface BenchmarkRow {
	name: string;
	f1: number;
	acc: number;
	wilson: number;
	rounds: number;
	lat50: number;
	lat95: number;
	params: number;
	time: string;
	winner?: boolean;
}

export interface BenchmarkBackboneCandidate {
	backbone?: string;
}

export interface BenchmarkTrainConfigResponse {
	gate_f1?: number;
	max_rounds?: number;
	max_train_samples?: number;
	backbones?: string[];
	results?: BenchmarkBackboneCandidate[];
}

export interface PreflightResult {
	check: string;
	passed: boolean;
	detail: string;
	blocker?: string;
}

export interface EvalQuestion {
	id: string;
	text: string;
	expected: string;
	predicted?: string | null;
	passed?: boolean | null;
}

export interface ResearchTimelineEntry {
	round: number;
	phase: string;
	query: string;
	resultLength: number;
	timestamp: number;
}

export interface DataFileRow {
	filename: string;
	className: string;
	split: string;
	path: string;
	text?: string;
}

export type Tab = "research" | "data" | "tune" | "train" | "benchmark" | "evaluate" | "promote";
export const TABS: Tab[] = ["research", "data", "tune", "train", "benchmark", "evaluate", "promote"];

export const API = "http://localhost:3001/api";
export const MONO = '"JetBrains Mono", "SF Mono", monospace';

export const GLOSSARY: Record<string, string> = {
	F1: "A score from 0 to 1 that balances how many correct predictions the model makes (precision) with how many it misses (recall). Higher is better.",
	"Macro F1": "F1 averaged equally across all classes — treats rare classes as important as common ones.",
	Precision: "Of all the items the model labeled as this class, how many were actually correct.",
	Recall: "Of all the items that actually belong to this class, how many did the model find.",
	Accuracy: "Percentage of all predictions that were correct. Can be misleading if classes are imbalanced.",
	Backbone:
		"The pre-trained model architecture used as a starting point (e.g., distilbert-base-uncased). Like choosing a foundation to build on.",
	"Learning Rate":
		"How much the model adjusts on each training step. Too high = unstable, too low = slow. Typical range: 1e-5 to 1e-3.",
	Epochs:
		"Number of times the model sees the entire training dataset. More epochs = more learning, but too many can cause overfitting.",
	"Batch Size": "Number of samples processed together in one training step. Larger = faster but uses more memory.",
	Holdout: "A separate test set the model has never seen during training — used to check real performance.",
	"Wilson CI":
		"Wilson confidence interval — a statistical range for the true score. Higher lower bound = more reliable result.",
	Gate: "A minimum quality threshold the model must meet before proceeding to the next step.",
	"Confusion Matrix":
		"A grid showing what the model predicted vs what was correct. Green diagonal = correct, red off-diagonal = mistakes.",
	Dropout: "Randomly disables parts of the model during training to prevent memorizing the training data.",
	"Weight Decay": "Penalizes large model weights to keep the model simple and generalizable.",
	"Label Smoothing": "Slightly softens the training targets to make the model less overconfident.",
	Augmentation:
		"Artificially modifying training data (mixing, cropping, erasing) to help the model generalize better.",
	ONNX: "Open Neural Network Exchange — a portable model format that runs on many platforms.",
	SafeTensors: "A safe, fast model file format. Preferred for HuggingFace models.",
	GGUF: "A model format optimized for CPU inference. Used by llama.cpp and similar tools.",
};
