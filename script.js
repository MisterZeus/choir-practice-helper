const safariWarning = document.getElementById('safariWarning')
const rewindButton = document.getElementById('rewind')
const fastForwardButton = document.getElementById('fastForward')
const playPauseButton = document.getElementById('playPause')
const stopButton = document.getElementById('stop')
const audioStatus = document.getElementById('audioStatus')
const trackProgressContainer = document.getElementById('trackProgressContainer')
const speedContainer = document.getElementById('speedContainer')
const backingVolumeControl = document.getElementById('backingVolumeControl')
const panningControls = document.getElementById('panningControls')
const progressLabel = document.getElementById('progressLabel')
const trackProgressSlider = document.getElementById('trackProgress')
const speedControl = document.getElementById('speedControl')
const speedLabel = document.getElementById('speedLabel')
const trackVolumes = document.getElementById('trackVolumes')
const panPresets = document.getElementById('panPresets')
const songSelect = document.getElementById('songSelect')
const fullMonoButton = document.getElementById('presetFullMono')
const fullStereoButton = document.getElementById('presetChoirStereo')
const leaderStereoButton = document.getElementById('presetLeaderStereo')
const backingVolumeSlider = document.getElementById('backingVolume')

let isLoadingAudio = false
let songFolder = "Accentuate"

let muteButtons = []
let trackVolumeSliders = []
let presetButtons = []
let panningSliders = []

const choirVoices = ['soprano', 'alto', 'tenor', 'bass', 'voice', 'top', 'middle', 'bottom']
const SEEK_SKIP_SECONDS = 5

function restoreStateFromUrl() {
    const params = new URLSearchParams(window.location.search)

    const restoredSong = params.get('s')
    const normalizedSong = normalizeSongFolder(restoredSong)

    if (normalizedSong) {
        songFolder = normalizedSong
    }
}

function updateUrlFromState() {
    const url = new URL(window.location.href)
    const params = url.searchParams

    if (songFolder) {
        params.set('s', String(songFolder))
    } else {
        params.delete('s')
    }

    url.search = params.toString() ? `?${params.toString()}` : ''
    window.history.replaceState({}, '', url.toString())
}

function resetUiForNewSong() {
    stopSourceNodes()
    void releaseWakeLock()
    updateMediaSessionPlaybackState('none')

    trackBuffers = []

    sourceNodes = []
    gainNodes = []
    panners = []

    if (playPauseButton) {
        playPauseButton.textContent = '▶️'
        playPauseButton.setAttribute('aria-label', 'Play audio')
        playPauseButton.setAttribute('aria-pressed', 'false')
    }
    if (stopButton) {
        stopButton.disabled = true
        stopButton.textContent = '⏹️'
        stopButton.setAttribute('aria-label', 'Stop playback')
    }
    if (rewindButton) { rewindButton.disabled = true }
    if (fastForwardButton) { fastForwardButton.disabled = true }

    if (audioStatus) { audioStatus.textContent = '' }
    if (safariWarning) { safariWarning.textContent = '' }

    if (progressLabel) { progressLabel.textContent = '0:00 / 0:00' }
    if (trackProgressSlider) { trackProgressSlider.value = 0 }

    muteButtons = []
    mutedStates = []

    trackVolumeSliders = []
    if (trackVolumes) { trackVolumes.replaceChildren() }
    trackVolumeValues = []
    heroVoice = ''

    presetButtons = []
    if (panPresets) { panPresets.style.display = 'none' }

    if (backingVolumeControl) { backingVolumeControl.style.display = 'none' }

    if (speedContainer) { speedContainer.style.display = 'none' }
    if (speedControl) { speedControl.value = 1 }
    if (speedLabel) { speedLabel.textContent = '1x' }
    playbackSpeed = 1
    activePlaybackSpeed = 1

    panningSliders = []
    if (panningControls) { panningControls.replaceChildren() }

    playhead = 0
    playbackStartedAt = 0
    isPlaying = false
    isPaused = true
    isSeeking = false

    clearInterval(progressTimer)
    progressTimer = null
}

function normalizePathValue(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/^\/+/, '')
        .replace(/\/$/, '')
}

function normalizeSongFolder(value) {
    return normalizePathValue(value)
        .replace(/^songs\//, '')
        .split('/')[0]
        .trim()
}

async function readAudioPaths() {
    const response = await fetch('./songs/audio_paths.txt')
    if (!response.ok) {
        throw new Error(`Could not read audio paths list: ${response.status}`)
    }

    return (await response.text())
        .split(/\r?\n/)
        .map((line) => normalizePathValue(line))
        .filter((line) => line && !line.startsWith('#'))
}

const audioPathsPromise = readAudioPaths()
const songAudioBufferPrefetches = new Map()
const decodedAudioBufferCache = new Map()

restoreStateFromUrl()

function getOptimalVoicePanValues(voiceCount, reverse = false) {
    if (voiceCount <= 1) {
        return [0]
    }

    const gap = 2 / (voiceCount - 1)
    const values = Array.from({ length: voiceCount }, (_, index) => -1 + index * gap)
    return reverse ? values.reverse() : values
}

function getVoiceOrder(file) {
    const lower = file.toLowerCase()

    if (lower.includes('soprano')) return 1
    if (lower.includes('alto')) return 2
    if (lower.includes('tenor')) return 3
    if (lower.includes('bass')) return 4
    if (lower.includes('top')) return 5
    if (lower.includes('middle')) return 6
    if (lower.includes('bottom')) return 7
    if (lower.includes('voice')) return 8

    if (lower.includes('sop')) return 1
    if (lower.includes('alt')) return 2
    if (lower.includes('ten')) return 3
    if (lower.includes('bas')) return 4
    if (lower.includes('mid')) return 6
    if (lower.includes('bot')) return 7

    return 9
}

function getSongFilesFromAudioPaths(audioPaths, targetFolder) {
    return audioPaths
        .map((path) => normalizePathValue(path).replace(/^songs\//, ''))
        .filter((path) => {
            const [folderName] = path.split('/')
            return folderName === targetFolder
        })
        .filter((path) => path.toLowerCase().endsWith(audioFileExtension.toLowerCase()))
        .map((path) => `./songs/${path}`)
        .sort((a, b) => getVoiceOrder(a) - getVoiceOrder(b))
}

// Fetch/decode progress is reported per cacheKey rather than per-call, since a song's audio is often already
// being fetched/decoded by a background prefetch by the time loadAudioBuffers() wants to show progress for it.
const songLoadProgressListeners = new Map()

function subscribeToLoadProgress(cacheKey, listener) {
    if (!songLoadProgressListeners.has(cacheKey)) {
        songLoadProgressListeners.set(cacheKey, new Set())
    }
    songLoadProgressListeners.get(cacheKey).add(listener)

    return () => {
        songLoadProgressListeners.get(cacheKey)?.delete(listener)
    }
}

function emitLoadProgress(cacheKey, phase, index, total) {
    songLoadProgressListeners.get(cacheKey)?.forEach((listener) => listener(phase, index, total))
}

function fetchAudioBlobs(urls, cacheKey) {
    return urls.map(async (url, index) => {
        emitLoadProgress(cacheKey, 'download', index + 1, urls.length)

        try {
            const response = await fetch(url)
            if (!response.ok) {
                throw new Error(`Could not fetch ${url}: ${response.status}`)
            }

            return await response.blob()
        } catch (error) {
            songAudioBufferPrefetches.delete(cacheKey)
            throw error
        }
    })
}

async function prefetchSongAudioBuffers(folder) {
    const targetFolder = normalizeSongFolder(folder)
    if (!targetFolder) {
        return []
    }

    const cacheKey = `${targetFolder}|${audioFileExtension}`
    if (!songAudioBufferPrefetches.has(cacheKey)) {
        const prefetchPromise = (async () => {
            const audioPaths = await audioPathsPromise
            const songFilesForFolder = getSongFilesFromAudioPaths(audioPaths, targetFolder)
            return fetchAudioBlobs(songFilesForFolder, cacheKey)
        })().catch((error) => {
            songAudioBufferPrefetches.delete(cacheKey)
            throw error
        })

        songAudioBufferPrefetches.set(cacheKey, prefetchPromise)
    }

    return songAudioBufferPrefetches.get(cacheKey)
}

function getSharedAudioContext() {
    if (!window.AudioContext && !window.webkitAudioContext) {
        throw new Error('Web Audio API is not supported in this browser.')
    }

    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)()

        // Mobile OSes can suspend/interrupt the context (e.g. screen lock, phone call); resume it automatically if we were playing.
        audioContext.onstatechange = () => {
            console.log('AudioContext: state changed to', audioContext.state)
            if (isPlaying && (audioContext.state === 'suspended' || audioContext.state === 'interrupted')) {
                void audioContext.resume()
            }
        }
    }

    return audioContext
}

let decodingAudioContext

// OfflineAudioContext can decode without a user gesture, unlike a real AudioContext.
function getDecodingAudioContext() {
    const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext
    if (!OfflineAudioContextClass) {
        throw new Error('Web Audio API is not supported in this browser.')
    }

    if (!decodingAudioContext) {
        decodingAudioContext = new OfflineAudioContextClass(1, 1, 44100)
    }

    return decodingAudioContext
}

// Decodes buffers in the background so playback can start instantly once the user presses play.
// Subscribe via subscribeToLoadProgress(cacheKey, ...) to observe download/decode progress for a folder.
async function preloadSongAudioBuffers(folder) {
    const targetFolder = normalizeSongFolder(folder)
    if (!targetFolder) {
        return []
    }

    const cacheKey = `${targetFolder}|${audioFileExtension}`
    if (!decodedAudioBufferCache.has(cacheKey)) {
        const decodePromise = (async () => {
            const context = getDecodingAudioContext()
            const audioBlobPromises = await prefetchSongAudioBuffers(targetFolder)

            const results = await Promise.allSettled(audioBlobPromises.map(async (audioBlobPromise, index) => {
                const audioBlob = await audioBlobPromise
                emitLoadProgress(cacheKey, 'decode', index + 1, audioBlobPromises.length)

                // Firefox may detach buffers after decodeAudioData; decode from a fresh buffer each time.
                const arrayBuffer = await audioBlob.arrayBuffer()
                return context.decodeAudioData(arrayBuffer)
            }))

            return results.map((result) => {
                if (result.status === 'rejected') {
                    throw result.reason
                }
                return result.value
            })
        })().catch((error) => {
            decodedAudioBufferCache.delete(cacheKey)
            throw error
        })

        decodedAudioBufferCache.set(cacheKey, decodePromise)
    }

    return decodedAudioBufferCache.get(cacheKey)
}

async function populateSongSelect() {
    if (!songSelect) {
        return
    }

    const currentSelection = normalizeSongFolder(songSelect.value || songFolder)
    songSelect.replaceChildren()

    const placeholderOption = document.createElement('option')
    placeholderOption.value = ''
    placeholderOption.textContent = '-- Choose a song --'
    songSelect.appendChild(placeholderOption)

    try {
        const audioPaths = await audioPathsPromise
        const songFolders = [...new Set(audioPaths
            .map((path) => normalizeSongFolder(path))
            .filter(Boolean))].sort()

        if (songFolders.length === 0) {
            const fallbackOption = document.createElement('option')
            fallbackOption.value = ''
            fallbackOption.textContent = 'No songs found'
            fallbackOption.disabled = true
            songSelect.appendChild(fallbackOption)
            songSelect.value = ''
            return
        }

        songFolders.forEach((folderName) => {
            const option = document.createElement('option')
            option.value = folderName
            option.textContent = folderName
            songSelect.appendChild(option)
        })

        const selectedValue = songFolders.includes(currentSelection)
            ? currentSelection
            : songFolders[0]

        songFolder = selectedValue
        songSelect.value = selectedValue
        updateUrlFromState()
        void preloadSongAudioBuffers(songFolder)
    } catch (error) {
        console.error('Error populating song select', error)
        const fallbackOption = document.createElement('option')
        fallbackOption.value = ''
        fallbackOption.textContent = 'No songs found'
        fallbackOption.disabled = true
        songSelect.appendChild(fallbackOption)
        songSelect.value = ''
    }
}

if (songSelect) {
    songSelect.addEventListener('change', async () => {
        const selectedSong = normalizeSongFolder(songSelect.value)
        if (!selectedSong) {
            return
        }

        songFolder = selectedSong
        updateUrlFromState()
        void preloadSongAudioBuffers(songFolder)

        resetUiForNewSong()

        await setupAudio()
    })
}

function getExpectedTrackCount() {
    return trackBuffers.length || songFiles.length
}

function createTrackControlRow(index, label, voiceName) {
    const row = document.createElement('div')
    row.className = 'trackControlRow'

    const labelElement = document.createElement('label')
    labelElement.textContent = label

    const muteButton = document.createElement('button')
    muteButton.type = 'button'
    muteButton.className = 'muteButton'
    muteButton.setAttribute('aria-label', `Mute ${voiceName}`)
    muteButton.textContent = '🔊'
    muteButton.addEventListener('click', () => muteTrack(index))

    const volumeSlider = document.createElement('input')
    volumeSlider.type = 'range'
    volumeSlider.title = `${voiceName} Volume`
    volumeSlider.setAttribute('aria-label', `${voiceName} volume`)
    volumeSlider.className = 'trackVolume'
    volumeSlider.min = '0'
    volumeSlider.max = '1'
    volumeSlider.value = '1'
    volumeSlider.step = '0.05'
    volumeSlider.disabled = true
    volumeSlider.addEventListener('input', (event) => {
        changeVolume(event.target.value, voiceName)
    })

    const presetButton = document.createElement('button')
    presetButton.type = 'button'
    presetButton.className = 'presetButton'
    presetButton.setAttribute('aria-label', `Set ${voiceName} as hero voice`)
    presetButton.textContent = '🦸'
    presetButton.addEventListener('click', () => {
        const presetPanValues = choirVoices.map((_, voiceIndex) => voiceIndex === index
            ? 0
            : voiceIndex < index ? 1 : -1)
        const targetVoice = choirVoices[index]
        const volumes = getHeroMixVolumes(targetVoice)

        if (heroVoice === targetVoice) {
            heroVoice = ''
            updateTrackVolumes(...getDefaultTrackVolumes())
            updatePanningValues(...getOptimalVoicePanValues(getExpectedTrackCount(), true))
            return
        }

        heroVoice = targetVoice
        updateTrackVolumes(...volumes)
        updatePanningValues(...presetPanValues)
    })

    row.append(labelElement, muteButton, volumeSlider, presetButton)
    return { row, muteButton, volumeSlider, presetButton }
}

function buildTrackControlRows() {
    if (!trackVolumes) {
        return []
    }

    trackVolumes.replaceChildren()

    const voiceNames = choirVoices
    const labels = ['S', 'A', 'T', 'B', 'V', 'Top', 'Mid', 'Bot']

    const rows = voiceNames
        .slice(0, getExpectedTrackCount())
        .map((voiceName, index) => createTrackControlRow(index, labels[index], voiceName))

    rows.forEach(({ row }) => {
        trackVolumes.appendChild(row)
    })

    return rows
}

function initializeMuteButtons() {
    const expectedMuteButtonCount = getExpectedTrackCount()
    muteButtons = Array.from(trackVolumes?.querySelectorAll('button.muteButton') || [])
        .slice(0, expectedMuteButtonCount)

    if (muteButtons.length !== expectedMuteButtonCount) {
        throw new Error(`Expected ${expectedMuteButtonCount} mute buttons, but found ${muteButtons.length}`)
    }
}

function initializeTrackVolumeSliders() {
    const expectedTrackVolumeSliderCount = getExpectedTrackCount()
    trackVolumeSliders = Array.from(trackVolumes?.querySelectorAll('input.trackVolume') || [])
        .slice(0, expectedTrackVolumeSliderCount)

    if (trackVolumeSliders.length !== expectedTrackVolumeSliderCount) {
        throw new Error(`Expected ${expectedTrackVolumeSliderCount} track volume sliders, but found ${trackVolumeSliders.length}`)
    }

    for (let index = 0; index < trackVolumeSliders.length; index += 1) {
        const slider = trackVolumeSliders[index]
        slider.disabled = false
    }
}

function initializePresetButtons() {
    const expectedPresetButtonCount = getExpectedTrackCount()
    presetButtons = Array.from(trackVolumes?.querySelectorAll('button.presetButton') || [])
        .slice(0, expectedPresetButtonCount)

    if (presetButtons.length !== expectedPresetButtonCount) {
        throw new Error(`Expected ${expectedPresetButtonCount} preset buttons, but found ${presetButtons.length}`)
    }
}

function createPanningControls() {
    if (!panningControls) {
        return []
    }

    panningControls.replaceChildren()

    const labels = ['S', 'A', 'T', 'B', 'V', 'Top', 'Mid', 'Bot']

    return Array.from({ length: getExpectedTrackCount() }, (_, index) => labels[index] || String(index + 1))
        .map((label, index) => {
            const row = document.createElement('div')
            const labelElement = document.createElement('label')
            labelElement.textContent = `${label} Left`

            const slider = document.createElement('input')
            slider.type = 'range'
            slider.title = `${label} Pan`
            slider.className = 'pan'
            slider.min = '-1'
            slider.max = '1'
            slider.step = '0.01'
            slider.value = getOptimalVoicePanValues(getExpectedTrackCount(), true)[index]
            slider.disabled = true

            const rightLabel = document.createElement('label')
            rightLabel.textContent = 'Right'

            row.append(labelElement, slider, rightLabel)
            panningControls.appendChild(row)
            return slider
        })
}

function initializePanningSliders() {
    const expectedPanningSliderCount = getExpectedTrackCount()

    panningSliders = Array.from(panningControls?.querySelectorAll('input.pan') || [])
        .slice(0, expectedPanningSliderCount)

    if (panningSliders.length !== expectedPanningSliderCount) {
        throw new Error(`Expected ${expectedPanningSliderCount} panning sliders, but found ${panningSliders.length}`)
    }

    for (let index = 0; index < panningSliders.length; index += 1) {
        const slider = panningSliders[index]
        slider.disabled = false
    }
}

// Safari 3.0+ "[object HTMLElementConstructor]"
const is_iOS_Safari = /constructor/i.test(window.HTMLElement)
    || (
        function (p) {
            return p.toString() === "[object SafariRemoteNotification]"
        })(!window['safari']
            || (typeof safari !== 'undefined' && window['safari'].pushNotification)
        )
    || [
        'iPad Simulator',
        'iPhone Simulator',
        'iPod Simulator',
        'iPad',
        'iPhone',
        'iPod'
    ].includes(navigator.platform)
    // iPad on iOS 13 detection
    || (navigator.userAgent.includes("Mac") && "ontouchend" in document)
    || /iPad|iPhone|iPod/.test(navigator.userAgent)

let audioFileExtension = ".opus"
if (is_iOS_Safari) {
    audioFileExtension = ".aac"
}

void preloadSongAudioBuffers(songFolder)

let songFiles = []

async function refreshSongFiles() {
    if (!songFolder) {
        songFiles = []
        return
    }

    const targetFolder = normalizeSongFolder(songFolder)
    const audioPaths = await audioPathsPromise

    songFiles = getSongFilesFromAudioPaths(audioPaths, targetFolder)
}

let heroVoice = ""
let backingVolume = parseFloat(backingVolumeSlider.value)

let audioContext
let trackBuffers = []
let gainNodes = []
let panners = []
let sourceNodes = []
let isPlaying = false
let isPaused = true
let isSeeking = false
let playhead = 0.0
let playbackStartedAt = 0.0
let progressTimer = null
let trackVolumeValues = []
let mutedStates = []
let playbackSpeed = 1.0
let activePlaybackSpeed = 1.0
let granularEngine = null
let wakeLock = null

// Granular time-stretch: replays short overlapping grains at a scaled read-speed so pitch stays constant while tempo changes.
// A *fixed* grain period always beats with sustained vocal harmonics (audible as warbling), no matter how short it is,
// so on top of a high overlap ratio and a smooth Hann window, we randomize both the grain period and the read
// position per grain to remove the single beat frequency entirely rather than just shifting it.
const GRAIN_DURATION = 0.12
const GRAIN_PERIOD = 0.03
const GRAIN_PERIOD_JITTER_RATIO = 0.6
const GRAIN_POSITION_JITTER = 0.008
const GRAIN_JITTER = 0.006
const GRAIN_SCHEDULE_LOOKAHEAD = 0.1
const GRAIN_SCHEDULE_INTERVAL = 25

const GRAIN_ENVELOPE_STEPS = 32
const GRAIN_ENVELOPE_CURVE = Float32Array.from(
    { length: GRAIN_ENVELOPE_STEPS },
    (_, index) => 0.5 * (1 - Math.cos((2 * Math.PI * index) / (GRAIN_ENVELOPE_STEPS - 1)))
)

class GranularEngine {
    constructor(audioContext) {
        this.audioContext = audioContext
        this.timer = null
        this.nextGrainTime = 0
        this.startPlayhead = 0
        this.startContextTime = 0
        this.speed = 1
    }

    start(startPlayhead, speed, startContextTime) {
        this.stop()
        this.startPlayhead = startPlayhead
        this.speed = speed
        this.startContextTime = startContextTime
        this.nextGrainTime = startContextTime
        this.scheduleAheadLoop()
    }

    stop() {
        clearTimeout(this.timer)
        this.timer = null
    }

    scheduleAheadLoop = () => {
        const duration = getTrackDuration()

        while (this.nextGrainTime < this.audioContext.currentTime + GRAIN_SCHEDULE_LOOKAHEAD) {
            const bufferPosition = this.startPlayhead + (this.nextGrainTime - this.startContextTime) * this.speed

            if (duration > 0 && bufferPosition >= duration) {
                this.stop()
                return
            }

            this.scheduleGrain(this.nextGrainTime, bufferPosition)
            this.nextGrainTime += GRAIN_PERIOD * (1 + (Math.random() - 0.5) * GRAIN_PERIOD_JITTER_RATIO)
        }

        this.timer = setTimeout(this.scheduleAheadLoop, GRAIN_SCHEDULE_INTERVAL)
    }

    scheduleGrain(time, bufferPosition) {
        const grainTime = time + Math.random() * GRAIN_JITTER
        const jitteredPosition = Math.max(0, bufferPosition + (Math.random() - 0.5) * GRAIN_POSITION_JITTER)

        trackBuffers.forEach((buffer, index) => {
            const gainNode = gainNodes[index]
            if (!gainNode || jitteredPosition >= buffer.duration) {
                return
            }

            const grainDuration = Math.min(GRAIN_DURATION, buffer.duration - jitteredPosition)

            const envelope = this.audioContext.createGain()
            envelope.connect(gainNode)
            envelope.gain.setValueCurveAtTime(GRAIN_ENVELOPE_CURVE, grainTime, grainDuration)

            const source = this.audioContext.createBufferSource()
            source.buffer = buffer
            source.connect(envelope)
            source.start(grainTime, jitteredPosition, grainDuration)
            source.stop(grainTime + grainDuration + 0.01)
        })
    }
}

function setStatus(message) {
    if (audioStatus) {
        audioStatus.textContent = message
    }
}

function formatAudioLoadError(error, folder) {
    const baseMessage = `Unable to load audio for ${folder}.`

    if (!error || !error.message) {
        return baseMessage
    }

    return `${baseMessage} ${error.message}`
}

if (playPauseButton) {
    playPauseButton.addEventListener('click', () => {
        playPause()
    })
}

function resetHeroVoiceAndMix(panValues) {
    heroVoice = ''
    updateTrackVolumes(...getDefaultTrackVolumes())
    updatePanningValues(...panValues)
}

function getDefaultTrackVolumes(trackCount = choirVoices.length) {
    return new Array(trackCount).fill(1.0)
}

function getHeroMixVolumes(voice) {
    const voiceIndex = choirVoices.indexOf(voice)
    if (voiceIndex === -1) {
        return null
    }

    const volumes = new Array(choirVoices.length).fill(backingVolume)
    volumes[voiceIndex] = 1.0
    return volumes
}

if (stopButton) {
    stopButton.addEventListener('click', () => {
        stop()
    })
}

if (rewindButton) {
    rewindButton.addEventListener('click', () => {
        rewind()
    })
}

if (fastForwardButton) {
    fastForwardButton.addEventListener('click', () => {
        fastForward()
    })
}

function rewind() {
    try {
        if (trackBuffers.length === 0) {
            return
        }

        const currentTime = getCurrentPlayhead()
        if (currentTime < SEEK_SKIP_SECONDS) {
            return
        }

        playhead = Math.max(0, currentTime - SEEK_SKIP_SECONDS)

        if (isPlaying) {
            startPlayback()
        } else {
            updateTrackProgress()
        }
    } catch (error) {
        console.error('Error during rewind', error)
    }
}

function fastForward() {
    try {
        if (trackBuffers.length === 0) {
            return
        }

        const duration = getTrackDuration()
        const currentTime = getCurrentPlayhead()
        if (currentTime > duration - SEEK_SKIP_SECONDS) {
            return
        }

        playhead = Math.min(duration, currentTime + SEEK_SKIP_SECONDS)

        if (isPlaying) {
            startPlayback()
        } else {
            updateTrackProgress()
        }
    } catch (error) {
        console.error('Error during fastForward', error)
    }
}

async function playPause() {
    try {
        if (isLoadingAudio) {
            return
        }

        if (!audioContext) {
            await setupAudio()
        }

        if (audioContext.state === 'suspended') {
            await audioContext.resume()
        }

        if (isPaused) {
            startPlayback()
        } else {
            pausePlayback()
        }

        if (is_iOS_Safari && isPlaying) {
            safariWarning.textContent = "⚠️ Safari detected." +
                " If you cannot hear the audio," +
                " please turn off your Silent mode and turn your volume up."
        };

        stopButton.disabled = false
        stopButton.textContent = '⏹️'
    } catch (error) {
        console.error('Error during audio setup', error)
        setStatus('Error during audio setup.'
            + '<br>On iOS Safari, audio files may need to be re-encoded to AAC for reliable playback.')
        return
    }
}

function stop() {
    try {
        stopSourceNodes()
        playhead = 0
        isPlaying = false
        isPaused = true
        clearInterval(progressTimer)
        playPauseButton.textContent = '▶️'
        playPauseButton.setAttribute('aria-label', 'Play audio')
        playPauseButton.setAttribute('aria-pressed', 'false')
        stopButton.disabled = true
        stopButton.textContent = '⬅️'
        updateTrackProgress()
        void releaseWakeLock()
        updateMediaSessionPlaybackState('none')

        if (is_iOS_Safari && !isPlaying) {
            safariWarning.textContent = ""
        };
    } catch (error) {
        console.error('Error during stop', error)
    }
}

async function requestWakeLock() {
    try {
        if (!('wakeLock' in navigator)) {
            console.log('Wake Lock: API not supported in this browser.')
            return
        }

        if (wakeLock) {
            return
        }

        wakeLock = await navigator.wakeLock.request('screen')
        console.log('Wake Lock: acquired.')

        wakeLock.addEventListener('release', () => {
            console.log('Wake Lock: released.')
            wakeLock = null
        })
    } catch (error) {
        console.error('Wake Lock: error acquiring lock', error)
    }
}

async function releaseWakeLock() {
    try {
        if (!wakeLock) {
            return
        }

        await wakeLock.release()
    } catch (error) {
        console.error('Wake Lock: error releasing lock', error)
    }
}

// The browser auto-releases the wake lock (and may suspend the AudioContext) when the tab is hidden; restore both once visible again.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isPlaying) {
        void requestWakeLock()
        if (audioContext && audioContext.state === 'suspended') {
            void audioContext.resume()
        }
    }
})

// Registering a Media Session tells mobile OSes this page is playing real media, which grants lock-screen
// controls and exempts audio playback from the background-tab throttling/suspension that would otherwise apply.
function setupMediaSession() {
    if (!('mediaSession' in navigator)) {
        console.log('Media Session: API not supported in this browser.')
        return
    }

    navigator.mediaSession.setActionHandler('play', () => { if (isPaused) { playPause() } })
    navigator.mediaSession.setActionHandler('pause', () => { if (isPlaying) { playPause() } })
    navigator.mediaSession.setActionHandler('stop', () => stop())
    navigator.mediaSession.setActionHandler('seekbackward', () => rewind())
    navigator.mediaSession.setActionHandler('seekforward', () => fastForward())
    console.log('Media Session: action handlers registered.')
}

function updateMediaSessionMetadata() {
    if (!('mediaSession' in navigator)) {
        return
    }

    navigator.mediaSession.metadata = new MediaMetadata({
        title: songFolder || 'Choir Practice Helper',
        artist: 'Choir Practice Helper',
    })
}

function updateMediaSessionPlaybackState(state) {
    if (!('mediaSession' in navigator)) {
        return
    }

    if (navigator.mediaSession.playbackState === state) {
        return
    }

    navigator.mediaSession.playbackState = state
    console.log('Media Session: playback state set to', state)
}

setupMediaSession()

async function setupAudio() {
    try {
        getSharedAudioContext()

        if (audioContext.state === 'suspended') {
            await audioContext.resume()
        }

        if (trackBuffers.length === 0) {
            await loadAudioBuffers()
        }

        if (trackBuffers.length === 0) {
            throw new Error(`No decoded audio buffers loaded for ${songFolder}.`)
        }

        const trackCount = getExpectedTrackCount()
        if (trackVolumeValues.length !== trackCount) {
            trackVolumeValues = getDefaultTrackVolumes(trackCount)
            mutedStates = new Array(trackCount).fill(false)
        }

        if (gainNodes.length === 0) {
            for (let index = 0; index < trackCount; index += 1) {
                const gainNode = audioContext.createGain()
                gainNode.gain.value = trackVolumeValues[index]

                const panner = audioContext.createStereoPanner()
                const panSlider = panningSliders[index]
                panner.pan.value = panSlider ? parseFloat(panSlider.value) : 0

                gainNode.connect(panner).connect(audioContext.destination)

                gainNodes[index] = gainNode
                panners[index] = panner
            }
        }

        updateTrackProgress()
    } catch (error) {
        console.error('Error during setupAudio', error)
    }
}

async function loadAudioBuffers() {
    try {
        isLoadingAudio = true
        playPauseButton.disabled = true
        setStatus('Loading audio tracks...')

        await refreshSongFiles()

        if (songFiles.length === 0) {
            setStatus(`No audio files found for ${songFolder}.`)
            throw new Error(`No audio files found for ${songFolder}.`)
        }

        buildTrackControlRows()
        initializeMuteButtons()
        initializeTrackVolumeSliders()
        initializePresetButtons()
        createPanningControls()

        if (backingVolumeControl) {
            backingVolumeControl.style.display = 'flex'
        }

        panPresets.style.display = 'flex'
        trackProgressContainer.style.display = 'flex'
        if (speedContainer) { speedContainer.style.display = 'flex' }

        const cacheKey = `${normalizeSongFolder(songFolder)}|${audioFileExtension}`
        const unsubscribeFromLoadProgress = subscribeToLoadProgress(cacheKey, (phase, index, total) => {
            const verb = phase === 'download' ? 'Downloading' : 'Decoding'
            setStatus(`${verb} audio track ${index} of ${total}...`)
        })

        let decodedBuffers
        try {
            decodedBuffers = await preloadSongAudioBuffers(songFolder)
        } finally {
            unsubscribeFromLoadProgress()
        }

        if (decodedBuffers.length !== songFiles.length) {
            throw new Error(`Expected ${songFiles.length} decoded buffers, but found ${decodedBuffers.length}`)
        }

        trackBuffers = decodedBuffers
        initializePanningSliders()

        stopButton.textContent = '⬅️'

        setStatus(`Loaded ${songFiles.length} audio tracks for ${songFolder}.`)

    } catch (error) {
        console.error('Error during loadAudioBuffers', error)
        setStatus(formatAudioLoadError(error, songFolder))
        throw error
    } finally {
        isLoadingAudio = false
        playPauseButton.disabled = false
    }
}

function startPlayback() {
    try {
        if (trackBuffers.length === 0) {
            return
        }

        if (audioContext.state === 'suspended') {
            return
        }

        const duration = getTrackDuration()
        if (duration > 0 && playhead >= duration) {
            playhead = 0
        }

        stopSourceNodes()
        activePlaybackSpeed = playbackSpeed
        playbackStartedAt = audioContext.currentTime
        const when = playbackStartedAt + 0.05

        if (Math.abs(activePlaybackSpeed - 1) < 0.001) {
            sourceNodes = []
            trackBuffers.forEach((buffer, index) => {
                const source = audioContext.createBufferSource()
                source.buffer = buffer
                source.connect(gainNodes[index])
                source.start(when, playhead)
                sourceNodes.push(source)
            })
        } else {
            if (!granularEngine) {
                granularEngine = new GranularEngine(audioContext)
            }
            granularEngine.start(playhead, activePlaybackSpeed, when)
        }

        isPlaying = true
        isPaused = false
        isSeeking = false
        playPauseButton.textContent = '⏸️'
        playPauseButton.setAttribute('aria-label', 'Pause audio')
        playPauseButton.setAttribute('aria-pressed', 'true')
        stopButton.disabled = false
        clearInterval(progressTimer)
        progressTimer = setInterval(updateTrackProgress, 250)
        void requestWakeLock()
        updateMediaSessionMetadata()
        updateMediaSessionPlaybackState('playing')
    } catch (error) {
        console.error('Error during startPlayback', error)
    }
}

function pausePlayback() {
    try {
        if (!isPlaying) {
            return
        }

        playhead = getCurrentPlayhead()
        stopSourceNodes()
        isPlaying = false
        isPaused = true
        clearInterval(progressTimer)
        playPauseButton.textContent = '▶️'
        playPauseButton.setAttribute('aria-label', 'Play audio')
        playPauseButton.setAttribute('aria-pressed', 'false')
        void releaseWakeLock()
        updateMediaSessionPlaybackState('paused')
    } catch (error) {
        console.error('Error during pause', error)
    }
}

function stopSourceNodes() {
    try {
        sourceNodes.forEach((source) => {
            try {
                source.stop(0)
            } catch (error) {
                // Ignore sources that have already finished.
            }
            try {
                source.disconnect()
            } catch (error) {
                // Ignore disconnect errors.
            }
        })
        sourceNodes = []

        if (granularEngine) {
            granularEngine.stop()
        }
    } catch (error) {
        console.error('Error during stopSourceNodes', error)
    }
}

function getTrackDuration() {
    try {
        return trackBuffers[0] ? trackBuffers[0].duration : 0
    } catch (error) {
        console.error('Error during getTrackDuration', error)
    }
}

function getCurrentPlayhead() {
    try {
        if (!isPlaying || !audioContext) {
            return playhead
        }
        return playhead + (audioContext.currentTime - playbackStartedAt) * activePlaybackSpeed
    } catch (error) {
        console.error('Error during getCurrentPlayhead', error)
    }
}

function changeSpeed(value) {
    try {
        const speed = parseFloat(value)
        if (isNaN(speed)) {
            return
        }

        if (isPlaying) {
            playhead = getCurrentPlayhead()
        }

        playbackSpeed = speed
        if (speedLabel) {
            speedLabel.textContent = `${speed}x`
        }

        if (isPlaying) {
            startPlayback()
        }
    } catch (error) {
        console.error('Error during changeSpeed', error)
    }
}

function formatTime(time) {
    try {
        const minutes = Math.floor(time / 60)
        const seconds = Math.floor(time % 60)
        return `${minutes}:${seconds.toString().padStart(2, '0')}`
    } catch (error) {
        console.error('Error during formatTime', error)
    }
}

function updateTrackProgress() {
    try {
        const duration = getTrackDuration()
        if (!duration) {
            return
        }

        let currentTime = isPlaying ? getCurrentPlayhead() : playhead
        if (currentTime >= duration) {
            currentTime = duration
            playhead = duration
            stopSourceNodes()
            isPlaying = false
            isPaused = true
            clearInterval(progressTimer)
            playPauseButton.textContent = '▶️'
            void releaseWakeLock()
            updateMediaSessionPlaybackState('none')
        }

        trackProgressSlider.value = (100 * currentTime) / duration

        progressLabel.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`

        if (rewindButton) {
            rewindButton.disabled = currentTime < SEEK_SKIP_SECONDS
        }
        if (fastForwardButton) {
            fastForwardButton.disabled = currentTime > duration - SEEK_SKIP_SECONDS
        }
    } catch (error) {
        console.error('Error during updateTrackProgress', error)
    }
}

function getVolumeSpeakerEmoji(value) {
    if (value < 0.2) {
        return '🔈'
    }
    if (value < 0.7) {
        return '🔉'
    }
    return '🔊'
}

function applyTrackVolumes(values) {
    values.forEach((value, index) => {
        trackVolumeValues[index] = value

        const targetGain = mutedStates[index] ? 0 : value

        if (gainNodes[index]) {
            gainNodes[index].gain.value = targetGain
        }
        if (trackVolumeSliders[index]) {
            trackVolumeSliders[index].value = value
        }

        if (!mutedStates[index] && muteButtons[index]) {
            muteButtons[index].textContent = getVolumeSpeakerEmoji(value)
        }
    })
}

function updateTrackVolumes(...values) {
    try {
        applyTrackVolumes(values.map((value) => parseFloat(value)))
    } catch (error) {
        console.error('Error during updateTrackVolumes', error)
    }
}

function changeVolume(value, track) {
    try {
        const volume = parseFloat(value)
        const voiceIndex = choirVoices.indexOf(track)

        if (voiceIndex !== -1) {
            const updatedVolumes = [...trackVolumeValues]
            updatedVolumes[voiceIndex] = volume
            applyTrackVolumes(updatedVolumes)
        }
    } catch (error) {
        console.error('Error during changeVolume', error)
    }
}

function updatePanningValues(...panValues) {
    panValues.forEach((panValue, index) => {
        const slider = panningSliders[index]
        if (slider) {
            slider.value = panValue
        }
    })

    panners.forEach((panner, index) => {
        const slider = panningSliders[index]
        if (panner && slider) {
            panner.pan.value = parseFloat(slider.value)
        }
    })
}

function seekTrack(value) {
    try {
        const percent = parseFloat(value)
        if (trackBuffers.length === 0) {
            return
        }

        const duration = getTrackDuration()

        if (!isNaN(duration) && duration > 0) {
            playhead = (percent / 100) * duration

            if (isPlaying || (isSeeking && isPaused)) {
                startPlayback()
            } else {
                updateTrackProgress()
            }
        }
    } catch (error) {
        console.error('Error during seekTrack', error)
    }
}

function muteTrack(index) {
    if (index < 0 || index >= mutedStates.length) {
        return
    }

    mutedStates[index] = !mutedStates[index]
    const button = muteButtons[index]
    if (button) {
        button.textContent = mutedStates[index] ? '🔇' : getVolumeSpeakerEmoji(trackVolumeValues[index])
    }
    if (trackVolumeSliders[index]) {
        trackVolumeSliders[index].disabled = mutedStates[index]
    }

    if (gainNodes[index]) {
        gainNodes[index].gain.value = mutedStates[index] ? 0 : trackVolumeValues[index]
    }
}

trackProgressSlider.addEventListener('input', (event) => {
    isSeeking = true
    pausePlayback()
    progressLabel.textContent = `${formatTime((event.target.value / 100) * getTrackDuration())} / ${formatTime(getTrackDuration())}`
    seekTrack(event.target.value)
})

if (speedControl) {
    speedControl.addEventListener('input', (event) => {
        if (speedLabel) {
            speedLabel.textContent = `${event.target.value}x`
        }
    })
}

panningSliders.forEach((slider, index) => {
    slider.addEventListener('input', (event) => {
        const value = parseFloat(event.target.value)
        if (panners[index]) {
            panners[index].pan.value = value
        }
    })
})

fullMonoButton.addEventListener('click', () => {
    resetHeroVoiceAndMix([0, 0, 0, 0, 0, 0, 0])
})

fullStereoButton.addEventListener('click', () => {
    resetHeroVoiceAndMix(getOptimalVoicePanValues(getExpectedTrackCount(), true))
})

leaderStereoButton.addEventListener('click', () => {
    resetHeroVoiceAndMix(getOptimalVoicePanValues(getExpectedTrackCount()))
})

backingVolumeSlider.addEventListener('input', () => {
    backingVolume = parseFloat(backingVolumeSlider.value)

    const volumes = getHeroMixVolumes(heroVoice)
    if (volumes) {
        updateTrackVolumes(...volumes)
    }
})

updateTrackProgress()
populateSongSelect()
