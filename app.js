let ws = null;
let audioContext = null;
let processor = null;
let source = null;
let stream = null;
let audioElement = null;

let mediaRecorder = null;
let recordingDestination = null;
let recordedChunks = [];
let receivedAudioChunks = [];
let receivedAudioSampleRate = 16000;
let receivedAudioPreviewUrl = null;
let receivedAudioRefreshTimer = null;

let nextPlaybackTime = 0;
let activePlaybackNodes = [];

const STREAM_SAMPLE_RATE = 16000;
const STREAM_ENCODING = "audio/x-l16";
const AUTH_TOKEN_STORAGE_KEY = "salonify.frontend.authToken";
const DEFAULT_API_BASE_URL = "https://georgianne-unblindfolded-crashingly.ngrok-free.dev"

const state = {
    mode: "idle",
    sourceType: null,
    streamId: null,
    authToken: null,
    sessionCallId: null,
    sessionStatus: null,
    streamConfig: null,
    lastPlayAudioAt: null,
    lastClearAudioAt: null,
    receivedAudioBytes: 0,
};

const ui = {};

document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    applyDefaults();
    bindUI();
    setStatus("Ready", "idle");
    renderSessionMeta();
    renderSelectedFile();
    updateControls();
    logLine("Browser client ready. This page now speaks the same event shape as your Nest gateway.", "system");
});

function cacheElements() {
    ui.authPanel = document.getElementById("authPanel");
    ui.emailInput = document.getElementById("emailInput");
    ui.passwordInput = document.getElementById("passwordInput");
    ui.toInput = document.getElementById("toInput");
    ui.fileInput = document.getElementById("fileInput");
    ui.fileName = document.getElementById("fileName");
    ui.statusBadge = document.getElementById("statusBadge");
    ui.sessionMeta = document.getElementById("sessionMeta");
    ui.loginBtn = document.getElementById("loginBtn");
    ui.startMicBtn = document.getElementById("startMicBtn");
    ui.startFileBtn = document.getElementById("startFileBtn");
    ui.stopBtn = document.getElementById("stopBtn");
    ui.downloadAudioBtn = document.getElementById("downloadAudioBtn");
    ui.downloadReceivedAudioBtn = document.getElementById("downloadReceivedAudioBtn");
    ui.clearLogBtn = document.getElementById("clearLogBtn");
    ui.output = document.getElementById("output");
    ui.receivedAudioPlayer = document.getElementById("receivedAudioPlayer");
    ui.receivedAudioMeta = document.getElementById("receivedAudioMeta");
}

function applyDefaults() {
    const storedToken = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (storedToken && !state.authToken) {
        state.authToken = storedToken;
    }
}

function bindUI() {
    ui.fileInput?.addEventListener("change", () => {
        renderSelectedFile();
        updateControls();
    });

    ui.emailInput?.addEventListener("input", updateControls);
    ui.passwordInput?.addEventListener("input", updateControls);
}

function getApiBaseUrl() {
    return DEFAULT_API_BASE_URL.replace(/\/$/, "");
}

function getTo() {
    return ui.toInput?.value.trim() || "";
}

function getEmail() {
    return ui.emailInput?.value.trim() || "";
}

function getPassword() {
    return ui.passwordInput?.value || "";
}

function getAuthToken() {
    return state.authToken || "";
}

function hasAuthToken() {
    return Boolean(getAuthToken());
}

function setAuthToken(token) {
    state.authToken = token || null;

    if (token) {
        window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
        window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }

    renderSessionMeta();
    updateControls();
}

function focusLoginFlow(message) {
    if (message) {
        logLine(message, "warning");
    }

    setStatus("Login required", "warning");

    if (ui.authPanel?.scrollIntoView) {
        ui.authPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    (getEmail() ? ui.passwordInput : ui.emailInput)?.focus();
}

function canStartStream() {
    return hasAuthToken() || (getEmail() && getPassword());
}

function isActive() {
    return state.mode === "connecting" || state.mode === "streaming";
}

function buildStreamId(prefix) {
    return `${prefix}-${Date.now()}`;
}

function renderSessionMeta() {
    if (!ui.sessionMeta) return;

    const items = [];

    items.push(`State: ${state.mode}`);

    const token = getAuthToken();
    if (token) {
        items.push(`Auth: connected`);
    } else {
        items.push(`Auth: missing`);
    }

    if (state.sourceType) {
        items.push(`Source: ${state.sourceType}`);
    }

    if (state.streamId) {
        items.push(`Stream ID: ${state.streamId}`);
    }

    items.push(`Codec: ${STREAM_ENCODING}`);
    items.push(`Rate: ${STREAM_SAMPLE_RATE} Hz`);

    if (state.lastPlayAudioAt) {
        items.push(`Last playAudio: ${state.lastPlayAudioAt}`);
    }

    if (state.lastClearAudioAt) {
        items.push(`Last clearAudio: ${state.lastClearAudioAt}`);
    }

    if (state.receivedAudioBytes > 0) {
        items.push(`Received audio: ${formatBytes(state.receivedAudioBytes)}`);
    }

    ui.sessionMeta.textContent = items.join(" | ");
}

function renderSelectedFile() {
    if (!ui.fileName || !ui.fileInput) return;

    const file = ui.fileInput.files?.[0];
    ui.fileName.textContent = file ? `Selected: ${file.name}` : "No file selected";
}

function setStatus(label, tone = "idle") {
    if (!ui.statusBadge) return;
    ui.statusBadge.textContent = label;
    ui.statusBadge.dataset.tone = tone;
}

function updateControls() {
    const active = isActive();
    const hasFile = Boolean(ui.fileInput?.files?.[0]);
    const hasRecording = recordedChunks.length > 0;
    const hasReceivedAudio = state.receivedAudioBytes > 0;
    const authenticated = hasAuthToken();

    if (ui.startMicBtn) ui.startMicBtn.disabled = active || !authenticated;
    if (ui.startFileBtn) ui.startFileBtn.disabled = active || !hasFile || !authenticated;
    if (ui.stopBtn) ui.stopBtn.disabled = !active;
    if (ui.downloadAudioBtn) ui.downloadAudioBtn.disabled = !hasRecording;
    if (ui.downloadReceivedAudioBtn) ui.downloadReceivedAudioBtn.disabled = !hasReceivedAudio;
    if (ui.loginBtn) ui.loginBtn.disabled = active || !getEmail() || !getPassword();

    if (!authenticated && !active) {
        setStatus("Login required", "warning");
    }

    renderSessionMeta();
    renderReceivedAudioMeta();
}

function logLine(message, tone = "system") {
    if (!ui.output) return;

    const row = document.createElement("div");
    row.className = `log log-${tone}`;
    row.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    ui.output.appendChild(row);
    ui.output.scrollTop = ui.output.scrollHeight;
}

function clearLog() {
    if (!ui.output) return;
    ui.output.textContent = "";
    logLine("Event log cleared.", "system");
}

function updateMode(mode, label, tone) {
    state.mode = mode;
    setStatus(label, tone);
    updateControls();
}

async function apiRequest(path, { method = "GET", body, token } = {}) {
    const headers = {
        Accept: "application/json",
    };

    const authToken = token !== undefined ? token : getAuthToken();
    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }

    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(new URL(path, getApiBaseUrl()), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let payload = null;

    if (text) {
        try {
            payload = JSON.parse(text);
        } catch (error) {
            payload = text;
        }
    }

    if (!response.ok) {
        const message = payload && typeof payload === "object"
            ? payload.message || payload.error || JSON.stringify(payload)
            : payload || `Request failed with status ${response.status}`;

        throw new Error(message);
    }

    return payload;
}

async function login() {
    const email = getEmail();
    const password = getPassword();

    if (!email || !password) {
        throw new Error("Email and password are required for login.");
    }

    const payload = await apiRequest("/auth/login", {
        method: "POST",
        body: { email, password },
        token: null,
    });

    const token = payload?.token;
    if (!token) {
        throw new Error("Login succeeded but no token was returned.");
    }

    setAuthToken(token);
    logLine(`Logged in successfully${payload?.salon?.name ? ` for ${payload.salon.name}` : ""}.`, "success");
    return payload;
}

async function ensureAuthToken() {
    const token = getAuthToken();
    if (token) {
        return token;
    }

    if (getEmail() && getPassword()) {
        const payload = await login();
        return payload.token;
    }

    focusLoginFlow("Please login first or paste an auth token before starting a stream.");
    throw new Error("Login required.");
}

async function createManualSession() {
    const token = await ensureAuthToken();
    const to = getTo();

    if (!to) {
        focusLoginFlow("Enter the destination number first.");
        throw new Error("Destination number is required.");
    }

    const payload = await apiRequest("/plivo-stream/manual/session", {
        method: "POST",
        body: {
            to,
        },
        token,
    });

    state.sessionCallId = payload?.callId || null;
    state.sessionStatus = payload?.status || null;

    renderSessionMeta();
    logLine(`Created manual session ${payload?.callId || "unknown"} (${payload?.status || "n/a"}).`, "success");

    return payload;
}

async function fetchManualStreamConfig(callId) {
    const token = await ensureAuthToken();
    const params = new URLSearchParams({
        callId,
    });

    const payload = await apiRequest(`/plivo-stream/manual/stream?${params.toString()}`, {
        method: "GET",
        token,
    });

    state.streamConfig = payload;

    if (payload?.welcomeMessage) {
        logLine(`Welcome message: ${payload.welcomeMessage}`, "system");
    }

    renderSessionMeta();
    return payload;
}

function buildAuthenticatedWebSocketUrl(websocketUrl, token) {
    const nextUrl = new URL(websocketUrl);

    // if (token) {
    //     nextUrl.searchParams.set("token", token);
    //     nextUrl.searchParams.set("authorization", `Bearer ${token}`);
    // }

    return nextUrl.toString();
}

function sendWS(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

async function ensureAudioContext(sampleRate = STREAM_SAMPLE_RATE) {
    if (!audioContext || audioContext.state === "closed") {
        audioContext = new AudioContext({ sampleRate });
        nextPlaybackTime = audioContext.currentTime;
    } else if (audioContext.state === "suspended") {
        await audioContext.resume();
    }

    return audioContext;
}

function decodeBase64ToPCM16(base64Payload) {
    const binary = atob(base64Payload);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new Int16Array(bytes.buffer.slice(0));
}

function pcm16ToFloat32(pcm16) {
    const float32 = new Float32Array(pcm16.length);

    for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768;
    }

    return float32;
}

function appendReceivedAudioChunk(pcm16Chunk, sampleRate) {
    receivedAudioChunks.push(new Int16Array(pcm16Chunk));
    receivedAudioSampleRate = sampleRate || receivedAudioSampleRate || STREAM_SAMPLE_RATE;
    state.receivedAudioBytes += pcm16Chunk.byteLength;
    scheduleReceivedAudioPreviewRefresh();
    updateControls();
}

function scheduleReceivedAudioPreviewRefresh() {
    if (receivedAudioRefreshTimer) {
        clearTimeout(receivedAudioRefreshTimer);
    }

    receivedAudioRefreshTimer = window.setTimeout(() => {
        refreshReceivedAudioPreview();
        receivedAudioRefreshTimer = null;
    }, 250);
}

function refreshReceivedAudioPreview() {
    if (!ui.receivedAudioPlayer || receivedAudioChunks.length === 0) {
        return;
    }

    const wavBlob = buildReceivedAudioBlob();
    const nextUrl = URL.createObjectURL(wavBlob);

    if (receivedAudioPreviewUrl) {
        URL.revokeObjectURL(receivedAudioPreviewUrl);
    }

    receivedAudioPreviewUrl = nextUrl;
    ui.receivedAudioPlayer.src = receivedAudioPreviewUrl;
    renderReceivedAudioMeta();
}

function renderReceivedAudioMeta() {
    if (!ui.receivedAudioMeta) return;

    if (!receivedAudioChunks.length) {
        ui.receivedAudioMeta.textContent = "No received audio yet";
        return;
    }

    const totalSamples = receivedAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const durationSeconds = totalSamples / (receivedAudioSampleRate || STREAM_SAMPLE_RATE);

    ui.receivedAudioMeta.textContent = [
        `Buffered: ${formatBytes(state.receivedAudioBytes)}`,
        `Duration: ${durationSeconds.toFixed(2)}s`,
        `Sample rate: ${receivedAudioSampleRate} Hz`,
    ].join(" | ");
}

function ensureRecordingDestination() {
    if (!audioContext) return null;

    if (!recordingDestination || recordingDestination.context !== audioContext) {
        recordingDestination = audioContext.createMediaStreamDestination();
    }

    return recordingDestination;
}

function attachSourceToRecorder() {
    if (source && recordingDestination) {
        source.connect(recordingDestination);
    }
}

function startRecorder() {
    if (!audioContext) return;

    recordedChunks = [];
    ensureRecordingDestination();

    try {
        mediaRecorder = new MediaRecorder(recordingDestination.stream, {
            mimeType: "audio/webm;codecs=opus",
        });
    } catch (error) {
        mediaRecorder = new MediaRecorder(recordingDestination.stream);
    }

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
            updateControls();
        }
    };

    mediaRecorder.start();
}

function stopRecorder() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }
}

function setupSocketHandlers() {
    ws.onmessage = async (event) => {
        let payload;

        try {
            payload = JSON.parse(event.data);
        } catch (error) {
            logLine("Received non-JSON message from server.", "error");
            return;
        }

        if (payload.event === "playAudio" && payload.media?.payload) {
            state.lastPlayAudioAt = new Date().toLocaleTimeString();
            renderSessionMeta();
            logLine(
                `Received playAudio (${payload.media.contentType || "unknown"}, ${payload.media.sampleRate || "n/a"} Hz)`,
                "success"
            );
            await playIncomingAudio(payload.media.payload, payload.media.contentType, payload.media.sampleRate);
            return;
        }

        if (payload.event === "clearAudio") {
            state.lastClearAudioAt = new Date().toLocaleTimeString();
            renderSessionMeta();
            logLine("Received clearAudio. Playback queue cleared.", "warning");
            clearIncomingAudio();
            return;
        }

        logLine(`Received message: ${JSON.stringify(payload)}`, "system");
    };

    ws.onerror = () => {
        setStatus("Socket error", "error");
        logLine("WebSocket error from the manual Plivo stream.", "error");
    };

    ws.onclose = () => {
        ws = null;
        if (state.mode !== "idle") {
            updateMode("idle", "Disconnected", "idle");
        }
        logLine("WebSocket connection closed.", "system");
    };
}

async function prepareStreamFlow(sourceType) {
    stop(false);
    clearReceivedAudio();

    state.sourceType = sourceType;
    state.streamId = buildStreamId(sourceType === "Microphone" ? "browser" : "file");

    updateMode("connecting", "Connecting", "connecting");

    const session = await createManualSession();
    const callId = session?.callId;

    if (!callId) {
        throw new Error("The session API did not return a callId.");
    }

    const streamConfig = await fetchManualStreamConfig(callId);
    const token = await ensureAuthToken();
    const websocketUrl = streamConfig?.websocketUrl;
    if (!websocketUrl) {
        throw new Error("The stream config did not return a websocketUrl.");
    }

    const socketUrlWithToken = buildAuthenticatedWebSocketUrl(websocketUrl, token);

    logLine(`Connecting to ${socketUrlWithToken}`, "system");

    ws = new WebSocket(socketUrlWithToken);
    setupSocketHandlers();

    await new Promise((resolve, reject) => {
        ws.addEventListener("open", () => {
            const startPayload = streamConfig?.startEvent || {
                event: "start",
                start: {
                    callId,
                    streamId: state.streamId,
                    to: getTo(),
                    tracks: ["inbound"],
                    mediaFormat: {
                        encoding: STREAM_ENCODING,
                        sampleRate: STREAM_SAMPLE_RATE,
                    },
                },
            };

            state.streamId = startPayload?.start?.streamId || state.streamId;
            sendWS(startPayload);
            updateMode("streaming", `${sourceType} live`, "live");
            logLine(`Sent start event for stream ${state.streamId}`, "success");
            logLine(`Start payload: ${JSON.stringify(startPayload.start || startPayload)}`, "system");
            resolve();
        });

        ws.addEventListener("error", () => {
            reject(new Error("Could not open websocket connection."));
        });
    });
}

async function runStreamFlow(sourceType, captureSetup) {
    if (isActive()) return;

    if (!canStartStream()) {
        focusLoginFlow("Login first, then we’ll create the session and open the websocket.");
        return;
    }

    try {
        await prepareStreamFlow(sourceType);
        await captureSetup();
    } catch (error) {
        logLine(error.message || `Unable to start ${sourceType.toLowerCase()} stream.`, "error");
        stop(false);
    }
}

async function start() {
    await runStreamFlow("Microphone", async () => {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
            },
        });

        await ensureAudioContext(STREAM_SAMPLE_RATE);

        source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(2048, 1, 1);

        source.connect(processor);
        processor.connect(audioContext.destination);

        ensureRecordingDestination();
        attachSourceToRecorder();
        startRecorder();

        processor.onaudioprocess = (event) => {
            const input = event.inputBuffer.getChannelData(0);
            const pcm16 = floatTo16BitPCM(input);

            sendWS({
                event: "media",
                media: {
                    payload: toBase64(pcm16.buffer),
                },
            });
        };

        logLine("Microphone capture started.", "success");
    });
}

async function startFile() {
    if (!canStartStream()) {
        focusLoginFlow("Login first, then we’ll create the session and open the websocket.");
        return;
    }

    const file = ui.fileInput?.files?.[0];
    if (!file) {
        setStatus("Choose a file first", "warning");
        logLine("Pick a local file before starting file streaming.", "warning");
        return;
    }

    await runStreamFlow("File", async () => {
        await ensureAudioContext();

        audioElement = new Audio();
        audioElement.src = URL.createObjectURL(file);
        audioElement.crossOrigin = "anonymous";

        source = audioContext.createMediaElementSource(audioElement);
        processor = audioContext.createScriptProcessor(2048, 1, 1);

        source.connect(processor);
        source.connect(audioContext.destination);
        processor.connect(audioContext.destination);

        ensureRecordingDestination();
        attachSourceToRecorder();
        startRecorder();

        processor.onaudioprocess = (event) => {
            const input = event.inputBuffer.getChannelData(0);
            const downsampled = downsampleBuffer(input, audioContext.sampleRate, STREAM_SAMPLE_RATE);
            const pcm16 = floatTo16BitPCM(downsampled);

            sendWS({
                event: "media",
                media: {
                    payload: toBase64(pcm16.buffer),
                },
            });
        };

        audioElement.onended = () => {
            logLine("File playback finished. Sending stop event.", "system");
            stop();
        };

        await audioElement.play();
        logLine(`File streaming started from ${file.name}`, "success");
    });
}

async function playIncomingAudio(base64Payload, contentType = STREAM_ENCODING, sampleRate = STREAM_SAMPLE_RATE) {
    if (contentType && !contentType.toLowerCase().includes("l16") && !contentType.toLowerCase().includes("pcm")) {
        logLine(`Incoming contentType ${contentType} may not decode correctly in the browser test client.`, "warning");
    }

    await ensureAudioContext(sampleRate || STREAM_SAMPLE_RATE);
    ensureRecordingDestination();

    const pcm16 = decodeBase64ToPCM16(base64Payload);
    const float32 = pcm16ToFloat32(pcm16);
    appendReceivedAudioChunk(pcm16, sampleRate || STREAM_SAMPLE_RATE);

    const buffer = audioContext.createBuffer(1, float32.length, sampleRate || STREAM_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const node = audioContext.createBufferSource();
    node.buffer = buffer;
    node.connect(audioContext.destination);

    if (recordingDestination) {
        node.connect(recordingDestination);
    }

    if (nextPlaybackTime < audioContext.currentTime) {
        nextPlaybackTime = audioContext.currentTime;
    }

    node.start(nextPlaybackTime);
    node.onended = () => {
        activePlaybackNodes = activePlaybackNodes.filter((entry) => entry !== node);
    };

    activePlaybackNodes.push(node);
    nextPlaybackTime += buffer.duration;
}

function clearIncomingAudio() {
    activePlaybackNodes.forEach((node) => {
        try {
            node.stop();
        } catch (error) {
            // Ignore already-ended playback nodes.
        }
    });

    activePlaybackNodes = [];
    nextPlaybackTime = audioContext ? audioContext.currentTime : 0;
}

function cleanupAudioGraph() {
    if (processor) {
        processor.onaudioprocess = null;
        try {
            processor.disconnect();
        } catch (error) {
            // no-op
        }
        processor = null;
    }

    if (source) {
        try {
            source.disconnect();
        } catch (error) {
            // no-op
        }
        source = null;
    }

    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
    }

    if (audioElement) {
        audioElement.pause();
        if (audioElement.src.startsWith("blob:")) {
            URL.revokeObjectURL(audioElement.src);
        }
        audioElement.src = "";
        audioElement = null;
    }

    clearIncomingAudio();
}

function cleanupSocket(shouldNotifyServer) {
    if (!ws) return;

    if (shouldNotifyServer && ws.readyState === WebSocket.OPEN) {
        const stopPayload = state.streamConfig?.stopEvent || {
            event: "stop",
        };

        sendWS(stopPayload);
        logLine(`Sent stop event for ${state.streamId}`, "system");
    }

    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
    }
}

function stop(shouldNotifyServer = true) {
    cleanupAudioGraph();
    cleanupSocket(shouldNotifyServer);
    stopRecorder();

    if (audioContext && audioContext.state !== "closed") {
        audioContext.close();
    }

    audioContext = null;
    recordingDestination = null;
    nextPlaybackTime = 0;
    state.mode = "idle";
    state.sourceType = null;
    state.streamId = null;
    state.sessionCallId = null;
    state.sessionStatus = null;
    state.streamConfig = null;
    state.lastPlayAudioAt = null;
    state.lastClearAudioAt = null;

    setStatus("Stopped", "idle");
    updateControls();
}

function clearReceivedAudio() {
    receivedAudioChunks = [];
    receivedAudioSampleRate = STREAM_SAMPLE_RATE;
    state.receivedAudioBytes = 0;

    if (receivedAudioRefreshTimer) {
        clearTimeout(receivedAudioRefreshTimer);
        receivedAudioRefreshTimer = null;
    }

    if (receivedAudioPreviewUrl) {
        URL.revokeObjectURL(receivedAudioPreviewUrl);
        receivedAudioPreviewUrl = null;
    }

    if (ui.receivedAudioPlayer) {
        ui.receivedAudioPlayer.removeAttribute("src");
        ui.receivedAudioPlayer.load();
    }

    updateControls();
}

function downloadAudio() {
    if (!recordedChunks.length) {
        setStatus("Nothing to download", "warning");
        logLine("No recorded browser audio is available yet.", "warning");
        return;
    }

    const blob = new Blob(recordedChunks, { type: "audio/webm" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `plivo-browser-session-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    logLine("Mixed browser audio downloaded.", "success");
}

function downloadReceivedAudio() {
    if (!receivedAudioChunks.length) {
        setStatus("No received audio", "warning");
        logLine("No returned audio has been buffered yet.", "warning");
        return;
    }

    const blob = buildReceivedAudioBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `received-audio-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    logLine("Received audio downloaded as WAV.", "success");
}

function buildReceivedAudioBlob() {
    const totalSamples = receivedAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Int16Array(totalSamples);
    let offset = 0;

    for (const chunk of receivedAudioChunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }

    return buildWavBlobFromPCM16(merged, receivedAudioSampleRate || STREAM_SAMPLE_RATE);
}

function buildWavBlobFromPCM16(samples, sampleRate) {
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;
    const dataSize = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < samples.length; i++) {
        view.setInt16(44 + (i * 2), samples[i], true);
    }

    return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view, offset, value) {
    for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i));
    }
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);

    for (let i = 0, offset = 0; i < float32Array.length; i++, offset += 2) {
        const sample = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    return new Int16Array(buffer);
}

function toBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);

    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
}

function downsampleBuffer(buffer, inputRate, outputRate) {
    if (inputRate === outputRate) {
        return buffer;
    }

    const ratio = inputRate / outputRate;
    const length = Math.round(buffer.length / ratio);
    const result = new Float32Array(length);
    let offset = 0;

    for (let i = 0; i < length; i++) {
        const nextOffset = Math.round((i + 1) * ratio);
        let total = 0;
        let count = 0;

        for (let j = offset; j < nextOffset && j < buffer.length; j++) {
            total += buffer[j];
            count += 1;
        }

        result[i] = count ? total / count : 0;
        offset = nextOffset;
    }

    return result;
}
