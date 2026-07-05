import { useCallback, useRef, useState } from "react";

export interface DeepgramVoiceInputOptions {
	apiKey?: string;
	wsUrl?: string;
	onTranscript?: (text: string, final: boolean) => void;
	onError?: (error: string) => void;
}

export interface DeepgramVoiceInputState {
	isRecording: boolean;
	isConnecting: boolean;
	transcript: string;
	partialTranscript: string;
	error?: string;
	start: () => Promise<void>;
	stop: () => void;
	reset: () => void;
}

export const DEFAULT_DEEPGRAM_WS_URL =
	"wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&interim_results=true&endpointing=300&vad_events=true";

function getEnvDeepgramKey(): string | undefined {
	try {
		const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
		return env?.VITE_DEEPGRAM_API_KEY ?? env?.DEEPGRAM_API_KEY;
	} catch {
		return undefined;
	}
}

function chooseMimeType(): string | undefined {
	const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
	return candidates.find(
		(candidate) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate),
	);
}

export function useDeepgramVoiceInput(options: DeepgramVoiceInputOptions = {}): DeepgramVoiceInputState {
	const [isRecording, setIsRecording] = useState(false);
	const [isConnecting, setIsConnecting] = useState(false);
	const [transcript, setTranscript] = useState("");
	const [partialTranscript, setPartialTranscript] = useState("");
	const [error, setError] = useState<string | undefined>();
	const streamRef = useRef<MediaStream | null>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const socketRef = useRef<WebSocket | null>(null);

	const stop = useCallback(() => {
		try {
			recorderRef.current?.stop();
		} catch {
			// Ignore recorder stop errors.
		}
		try {
			socketRef.current?.send(JSON.stringify({ type: "CloseStream" }));
			socketRef.current?.close();
		} catch {
			// Ignore socket stop errors.
		}
		streamRef.current?.getTracks().forEach((track) => track.stop());
		recorderRef.current = null;
		socketRef.current = null;
		streamRef.current = null;
		setIsRecording(false);
		setIsConnecting(false);
	}, []);

	const reset = useCallback(() => {
		setTranscript("");
		setPartialTranscript("");
		setError(undefined);
	}, []);

	const start = useCallback(async () => {
		setError(undefined);
		const apiKey = options.apiKey ?? getEnvDeepgramKey();
		if (!apiKey) {
			const message = "Deepgram API key missing. Set VITE_DEEPGRAM_API_KEY or pass deepgramApiKey.";
			setError(message);
			options.onError?.(message);
			return;
		}
		if (!navigator.mediaDevices?.getUserMedia) {
			const message = "Browser microphone API is unavailable.";
			setError(message);
			options.onError?.(message);
			return;
		}

		setIsConnecting(true);
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		streamRef.current = stream;
		const socket = new WebSocket(options.wsUrl ?? DEFAULT_DEEPGRAM_WS_URL, ["token", apiKey]);
		socketRef.current = socket;

		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("Deepgram WebSocket failed to open"));
		}).catch((err: Error) => {
			stop();
			const message = err.message;
			setError(message);
			options.onError?.(message);
			throw err;
		});

		const mimeType = chooseMimeType();
		const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
		recorderRef.current = recorder;
		recorder.ondataavailable = async (event) => {
			if (!event.data.size || socket.readyState !== WebSocket.OPEN) return;
			socket.send(await event.data.arrayBuffer());
		};
		socket.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data as string);
				const text = message?.channel?.alternatives?.[0]?.transcript ?? "";
				if (!text) return;
				const isFinal = Boolean(message?.is_final || message?.speech_final);
				if (isFinal) {
					setTranscript((current) => `${current} ${text}`.trim());
					setPartialTranscript("");
				} else {
					setPartialTranscript(text);
				}
				options.onTranscript?.(text, isFinal);
			} catch {
				// Ignore non-JSON Deepgram control frames.
			}
		};
		socket.onclose = () => {
			setIsRecording(false);
			setIsConnecting(false);
		};
		recorder.start(250);
		setIsRecording(true);
		setIsConnecting(false);
	}, [options, stop]);

	return { isRecording, isConnecting, transcript, partialTranscript, error, start, stop, reset };
}
