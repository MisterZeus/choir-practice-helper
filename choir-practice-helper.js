const playPauseButton = document.getElementById('playPause')
const stopButton = document.getElementById('stop')
const safariWarning = document.getElementById('safariWarning')
const audioStatus = document.getElementById('audioStatus')
const progressLabel = document.getElementById('progressLabel')

const trackProgressSlider = document.getElementById('trackProgress')

const muteSopranoButton = document.getElementById('muteSoprano')
const muteAltoButton = document.getElementById('muteAlto')
const muteTenorButton = document.getElementById('muteTenor')
const muteBassButton = document.getElementById('muteBass')

const sopranoButton = document.getElementById('presetSop')
const altoButton = document.getElementById('presetAlto')
const tenorButton = document.getElementById('presetTenor')
const bassButton = document.getElementById('presetBass')

const fullMonoButton = document.getElementById('presetFullMono')
const fullStereoButton = document.getElementById('presetChoirStereo')
const leaderStereoButton = document.getElementById('presetLeaderStereo')

const backingVolumeSlider = document.getElementById('backingVolume')

let totalExpectedFiles = 4

const panningSliders = Array.from(document.querySelectorAll('input[class="pan"]'))
if (panningSliders.length !== totalExpectedFiles) {
    throw new Error(`Expected ${totalExpectedFiles} panning sliders, but found ${panningSliders.length}`)
}

const trackVolumeSliders = Array.from(document.querySelectorAll('input[class="trackVolume"]'))
if (trackVolumeSliders.length !== totalExpectedFiles) {
    throw new Error(`Expected ${totalExpectedFiles} track volume sliders, but found ${trackVolumeSliders.length}`)
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

let songFiles = [
    "./" + songFolder + "/sop-accentuate" + audioFileExtension,
    "./" + songFolder + "/alto-accentuate" + audioFileExtension,
    "./" + songFolder + "/tenor-accentuate" + audioFileExtension,
    "./" + songFolder + "/bass-accentuate" + audioFileExtension
]

if (songFiles.length !== totalExpectedFiles) {
    throw new Error(`Expected ${totalExpectedFiles} audio files, but found ${songFiles.length}`)
}

let heroVoice = ""
let otherVoicesReducedVolume = parseFloat(backingVolumeSlider.value)

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
let trackVolumeValues = new Array(totalExpectedFiles).fill(1)
let mutedStates = new Array(totalExpectedFiles).fill(false)

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

        if (gainNodes.length === 0) {
            for (let index = 0; index < totalExpectedFiles; index += 1) {
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
    mutedStates[index] = !mutedStates[index]
    const button = [muteSopranoButton, muteAltoButton, muteTenorButton, muteBassButton][index]
    button.textContent = mutedStates[index] ? '🔇' : '🔊'
    trackVolumeSliders[index].disabled = mutedStates[index]

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

sopranoButton.addEventListener('click', () => {
    heroVoice = "soprano"
    updateTrackVolumes(1.0, otherVoicesReducedVolume, otherVoicesReducedVolume, otherVoicesReducedVolume)
    updatePanningValues(0, -1, -1, -1)
})

altoButton.addEventListener('click', () => {
    heroVoice = "alto"
    updateTrackVolumes(otherVoicesReducedVolume, 1.0, otherVoicesReducedVolume, otherVoicesReducedVolume)
    updatePanningValues(1, 0, -1, -1)
})

tenorButton.addEventListener('click', () => {
    heroVoice = "tenor"
    updateTrackVolumes(otherVoicesReducedVolume, otherVoicesReducedVolume, 1.0, otherVoicesReducedVolume)
    updatePanningValues(1, 1, 0, -1)
})

bassButton.addEventListener('click', () => {
    heroVoice = "bass"
    updateTrackVolumes(otherVoicesReducedVolume, otherVoicesReducedVolume, otherVoicesReducedVolume, 1.0)
    updatePanningValues(1, 1, 1, 0)
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
    otherVoicesReducedVolume = parseFloat(backingVolumeSlider.value)

    if (heroVoice === "soprano") {
        updateTrackVolumes(1.0, otherVoicesReducedVolume, otherVoicesReducedVolume, otherVoicesReducedVolume)
    } else if (heroVoice === "alto") {
        updateTrackVolumes(otherVoicesReducedVolume, 1.0, otherVoicesReducedVolume, otherVoicesReducedVolume)
    } else if (heroVoice === "tenor") {
        updateTrackVolumes(otherVoicesReducedVolume, otherVoicesReducedVolume, 1.0, otherVoicesReducedVolume)
    } else if (heroVoice === "bass") {
        updateTrackVolumes(otherVoicesReducedVolume, otherVoicesReducedVolume, otherVoicesReducedVolume, 1.0)
    }
})

updateTrackProgress()
