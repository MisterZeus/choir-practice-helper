const playPauseButton = document.getElementById('playPause')
const stopButton = document.getElementById('stop')
const safariWarning = document.getElementById('safariWarning')
const audioStatus = document.getElementById('audioStatus')
const progressLabel = document.getElementById('progressLabel')

const trackProgressSlider = document.getElementById('trackProgress')

let totalExpectedFiles = 4

const trackVolumes = document.getElementById('trackVolumes')

let muteButtons = []

function getExpectedTrackCount() {
    return trackBuffers.length || songFiles.length || totalExpectedFiles
}

const muteButtonIds = [
    'muteSoprano',
    'muteAlto',
    'muteTenor',
    'muteBass'
]

function initializeMuteButtons() {
    const expectedMuteButtonCount = getExpectedTrackCount()
    muteButtons = muteButtonIds
        .slice(0, expectedMuteButtonCount)
        .map((id) => document.getElementById(id))
        .filter(Boolean)

    if (muteButtons.length !== expectedMuteButtonCount) {
        throw new Error(`Expected ${expectedMuteButtonCount} mute buttons, but found ${muteButtons.length}`)
    }
}

let trackVolumeSliders = []

function initializeTrackVolumeSliders() {
    const expectedTrackVolumeSliderCount = getExpectedTrackCount()
    trackVolumeSliders = Array.from(document.querySelectorAll('input[class="trackVolume"]'))
        .slice(0, expectedTrackVolumeSliderCount)

    if (trackVolumeSliders.length !== expectedTrackVolumeSliderCount) {
        throw new Error(`Expected ${expectedTrackVolumeSliderCount} track volume sliders, but found ${trackVolumeSliders.length}`)
    }

    for (let index = 0; index < trackVolumeSliders.length; index += 1) {
        const slider = trackVolumeSliders[index]
        slider.disabled = false
    }
}

let presetButtons = []
const presetButtonIds = [
    'presetSop',
    'presetAlto',
    'presetTenor',
    'presetBass'
]

function initializePresetButtons() {
    const expectedPresetButtonCount = getExpectedTrackCount()
    presetButtons = presetButtonIds
        .slice(0, expectedPresetButtonCount)
        .map((id) => document.getElementById(id))
        .filter(Boolean)

    if (presetButtons.length !== expectedPresetButtonCount) {
        throw new Error(`Expected ${expectedPresetButtonCount} preset buttons,"
            + "<br>but found ${presetButtons.length}`)
    }

    presetButtons.forEach((button, index) => {
        button.addEventListener('click', () => {
            const presetVoices = ['soprano', 'alto', 'tenor', 'bass']
            const presetPanValues = [
                [0, -1, -1, -1],
                [1, 0, -1, -1],
                [1, 1, 0, -1],
                [1, 1, 1, 0]
            ]
            const volumes = [backingVolume, backingVolume, backingVolume, backingVolume]
            volumes[index] = 1.0

            if (heroVoice === presetVoices[index]) {
                heroVoice = ""
                updateTrackVolumes(1.0, 1.0, 1.0, 1.0)
                updatePanningValues(1, 0.35, -0.35, -1)
                return
            }

            heroVoice = presetVoices[index]
            updateTrackVolumes(...volumes)
            updatePanningValues(...presetPanValues[index])
        })
    })
}

const fullMonoButton = document.getElementById('presetFullMono')
const fullStereoButton = document.getElementById('presetChoirStereo')
const leaderStereoButton = document.getElementById('presetLeaderStereo')

const backingVolumeSlider = document.getElementById('backingVolume')

let panningSliders = []

function initializePanningSliders() {
    const expectedPanningSliderCount = getExpectedTrackCount()

    panningSliders = Array.from(document.querySelectorAll('input[class="pan"]'))
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


let songFolder = "Accentuate"

let audioFileExtension = ".opus"
if (is_iOS_Safari) {
    audioFileExtension = ".aac"
}

let songFiles = []

async function refreshSongFiles() {
    if (!songFolder) {
        return
    }

    const folderPath = `./${songFolder.replace(/^\.\/?/, '').replace(/\/$/, '')}`
    const response = await fetch(folderPath)
    if (!response.ok) {
        throw new Error(`Could not read folder ${folderPath}: ${response.status}`)
    }

    const html = await response.text()
    const matches = [...html.matchAll(/href=["']([^"']+)["']/g)]
    const availableFiles = matches
        .map((match) => match[1])
        .filter((file) => file.endsWith(audioFileExtension))
        .map((file) => file.replace(/\\/g, '/'))
        .map((file) => {
            const normalizedFile = file.replace(/^\.\//, '').replace(/^\/+/, '')
            const normalizedFolder = folderPath.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/$/, '')

            if (normalizedFile === normalizedFolder || normalizedFile.startsWith(`${normalizedFolder}/`)) {
                return `./${normalizedFile}`
            }

            return `./${normalizedFolder}/${normalizedFile}`
        })

    songFiles = availableFiles.sort((a, b) => {
        const getVoiceOrder = (file) => {
            const lower = file.toLowerCase()
            if (lower.includes('sop')) return 0
            if (lower.includes('alto')) return 1
            if (lower.includes('tenor')) return 2
            if (lower.includes('bass')) return 3
            return 4
        }

        return getVoiceOrder(a) - getVoiceOrder(b)
    })
    console.log(songFiles)
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
let playhead = 0
let playbackStartedAt = 0
let progressTimer = null
let trackVolumeValues = []
let mutedStates = []

function setStatus(message) {
    if (audioStatus) {
        audioStatus.textContent = message
    }
}

async function playPause() {
    try {
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
                "<br>If you cannot hear the audio," +
                "<br>please turn off your Silent mode and turn your volume up."
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
        stopButton.disabled = true
        stopButton.textContent = '⬅️'
        updateTrackProgress()

        if (is_iOS_Safari && !isPlaying) {
            safariWarning.textContent = ""
        };
    } catch (error) {
        console.error('Error during stop', error)
    }
}

async function setupAudio() {
    try {
        if (!window.AudioContext && !window.webkitAudioContext) {
            throw new Error('Web Audio API is not supported in this browser.')
        }

        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)()
        }

        if (audioContext.state === 'suspended') {
            await audioContext.resume()
        }

        if (trackBuffers.length === 0) {
            await loadAudioBuffers()
        }

        const trackCount = getExpectedTrackCount()
        if (trackVolumeValues.length !== trackCount) {
            trackVolumeValues = new Array(trackCount).fill(1)
            mutedStates = new Array(trackCount).fill(false)
        }

        if (gainNodes.length === 0) {
            for (let index = 0; index < trackCount; index += 1) {
                const gainNode = audioContext.createGain()
                gainNode.gain.value = trackVolumeValues[index]

                const panner = audioContext.createStereoPanner()
                panner.pan.value = parseFloat(panningSliders[index].value)

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
        stopButton.textContent = '.'

        await refreshSongFiles()

        if (songFiles.length !== totalExpectedFiles) {
            throw new Error(`Expected ${totalExpectedFiles} audio files, but found ${songFiles.length}`)
        }

        const urls = songFiles
        const decodedBuffers = []

        for (const url of urls) {
            try {
                const response = await fetch(url)
                if (!response.ok) {
                    throw new Error(`Could not fetch ${url}: ${response.status}`)
                }

                const arrayBuffer = await response.arrayBuffer()

                const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer)
                decodedBuffers.push(decodedBuffer)

                stopButton.textContent += '.'
            } catch (error) {
                console.error('Failed to decode audio', error)
                throw error
            }
        }

        trackBuffers = decodedBuffers
        initializeMuteButtons()
        initializePresetButtons()
        initializeTrackVolumeSliders()
        initializePanningSliders()

    } catch (error) {
        console.error('Error during loadAudioBuffers', error)
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
        playbackStartedAt = audioContext.currentTime
        const when = playbackStartedAt + 0.05
        sourceNodes = []

        trackBuffers.forEach((buffer, index) => {
            const source = audioContext.createBufferSource()
            source.buffer = buffer
            source.connect(gainNodes[index])
            source.start(when, playhead)
            sourceNodes.push(source)
        })

        isPlaying = true
        isPaused = false
        isSeeking = false
        playPauseButton.textContent = '⏸️'
        stopButton.disabled = false
        clearInterval(progressTimer)
        progressTimer = setInterval(updateTrackProgress, 250)
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
        return playhead + (audioContext.currentTime - playbackStartedAt)
    } catch (error) {
        console.error('Error during getCurrentPlayhead', error)
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
        }

        trackProgressSlider.value = (100 * currentTime) / duration

        progressLabel.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`
    } catch (error) {
        console.error('Error during updateTrackProgress', error)
    }
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

        let lowVolumeThreshold = 0.1
        let mediumVolumeThreshold = 0.5
        let hysterisis = 0.3

        if (!mutedStates[index]) {
            if (trackVolumeSliders[index].value < lowVolumeThreshold) {
                muteButtons[index].textContent = '🔈'
                lowVolumeThreshold += hysterisis
            } else if (trackVolumeSliders[index].value >= lowVolumeThreshold
                && trackVolumeSliders[index].value < mediumVolumeThreshold) {
                muteButtons[index].textContent = '🔉'
                lowVolumeThreshold -= hysterisis
                mediumVolumeThreshold += hysterisis
            } else {
                muteButtons[index].textContent = '🔊'
                mediumVolumeThreshold -= hysterisis
            };
        }
    })
}

function updateTrackVolumes(s, a, t, b) {
    try {
        applyTrackVolumes([
            parseFloat(s),
            parseFloat(a),
            parseFloat(t),
            parseFloat(b)
        ])
    } catch (error) {
        console.error('Error during updateTrackVolumes', error)
    }
}

function changeVolume(value, track) {
    try {
        const volume = parseFloat(value)
        if (track === 'soprano') {
            applyTrackVolumes([volume, trackVolumeValues[1], trackVolumeValues[2], trackVolumeValues[3]])
        } else if (track === 'alto') {
            applyTrackVolumes([trackVolumeValues[0], volume, trackVolumeValues[2], trackVolumeValues[3]])
        } else if (track === 'tenor') {
            applyTrackVolumes([trackVolumeValues[0], trackVolumeValues[1], volume, trackVolumeValues[3]])
        } else if (track === 'bass') {
            applyTrackVolumes([trackVolumeValues[0], trackVolumeValues[1], trackVolumeValues[2], volume])
        }
    } catch (error) {
        console.error('Error during changeVolume', error)
    }
}

function updatePanningValues(s, a, t, b) {
    panningSliders[0].value = s
    panningSliders[1].value = a
    panningSliders[2].value = t
    panningSliders[3].value = b

    panners.forEach((panner, index) => {
        if (panner) {
            panner.pan.value = parseFloat(panningSliders[index].value)
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
        button.textContent = mutedStates[index] ? '🔇' : '🔊'
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

panningSliders.forEach((slider, index) => {
    slider.addEventListener('input', (event) => {
        const value = parseFloat(event.target.value)
        if (panners[index]) {
            panners[index].pan.value = value
        }
    })
})

fullMonoButton.addEventListener('click', () => {
    heroVoice = ""
    updateTrackVolumes(1.0, 1.0, 1.0, 1.0)
    updatePanningValues(0, 0, 0, 0)
})

let middleVoicesPan = 0.35

fullStereoButton.addEventListener('click', () => {
    heroVoice = ""
    updateTrackVolumes(1.0, 1.0, 1.0, 1.0)
    updatePanningValues(1, middleVoicesPan, -middleVoicesPan, -1)
})

leaderStereoButton.addEventListener('click', () => {
    heroVoice = ""
    updateTrackVolumes(1.0, 1.0, 1.0, 1.0)
    updatePanningValues(-1, -middleVoicesPan, middleVoicesPan, 1)
})

backingVolumeSlider.addEventListener('input', () => {
    backingVolume = parseFloat(backingVolumeSlider.value)

    if (heroVoice === "soprano") {
        updateTrackVolumes(1.0, backingVolume, backingVolume, backingVolume)
    } else if (heroVoice === "alto") {
        updateTrackVolumes(backingVolume, 1.0, backingVolume, backingVolume)
    } else if (heroVoice === "tenor") {
        updateTrackVolumes(backingVolume, backingVolume, 1.0, backingVolume)
    } else if (heroVoice === "bass") {
        updateTrackVolumes(backingVolume, backingVolume, backingVolume, 1.0)
    }
})

updateTrackProgress()
