const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

function createApp() {
    const downloads = []
    const decodes = []
    const element = { value: '1', addEventListener() {} }
    const document = {
        getElementById(id) { return id === 'songSelect' ? null : element },
        addEventListener() {},
    }
    class OfflineAudioContext {
        decodeAudioData(data) {
            const operation = deferred()
            decodes.push({ data, ...operation })
            return operation.promise
        }
    }
    const context = vm.createContext({
        document,
        window: {
            location: { search: '', href: 'https://example.test/' },
            OfflineAudioContext,
        },
        navigator: { platform: '', userAgent: '' },
        URLSearchParams,
        URL,
        console,
        fetch(url) {
            if (url === './songs/audio_paths.txt') {
                return Promise.resolve({
                    ok: true,
                    text: async () => 'Test/soprano.opus\nTest/alto.opus\nTest/tenor.opus',
                })
            }
            const operation = deferred()
            downloads.push({ url, ...operation })
            return operation.promise
        },
    })
    const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8')
    vm.runInContext(source, context)
    return { context, downloads, decodes }
}

function finishDownload(download) {
    download.resolve({
        ok: true,
        blob: async () => ({ arrayBuffer: async () => download.url }),
    })
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('downloads concurrently, decodes as each finishes, and preserves track order', async () => {
    const { context, downloads, decodes } = createApp()
    const result = context.preloadSongAudioBuffers('Test')
    const sharedResult = context.preloadSongAudioBuffers('Test')
    await tick()

    assert.equal(downloads.length, 3)
    finishDownload(downloads[1])
    await tick()
    assert.deepEqual(decodes.map(({ data }) => data), [downloads[1].url])

    finishDownload(downloads[2])
    finishDownload(downloads[0])
    await tick()
    assert.equal(decodes.length, 3)

    let finished = false
    result.then(() => { finished = true })
    decodes[0].resolve('alto')
    decodes[1].resolve('tenor')
    await tick()
    assert.equal(finished, false)
    decodes[2].resolve('soprano')

    assert.deepEqual(Array.from(await result), ['soprano', 'alto', 'tenor'])
    assert.deepEqual(Array.from(await sharedResult), ['soprano', 'alto', 'tenor'])
    assert.equal(downloads.length, 3)
})

test('waits for other decodes on failure and reuses downloaded blobs on retry', async () => {
    const { context, downloads, decodes } = createApp()
    const result = context.preloadSongAudioBuffers('Test')
    await tick()
    downloads.forEach(finishDownload)
    await tick()

    let finished = false
    result.then(() => { finished = true }, () => { finished = true })
    decodes[0].reject(new Error('decode failed'))
    decodes[1].resolve('alto')
    await tick()
    assert.equal(finished, false)
    decodes[2].resolve('tenor')
    await assert.rejects(result, /decode failed/)

    const retry = context.preloadSongAudioBuffers('Test')
    await tick()
    assert.equal(downloads.length, 3)
    assert.equal(decodes.length, 6)
    decodes.slice(3).forEach(({ resolve }) => resolve('decoded'))
    assert.equal((await retry).length, 3)
})

test('retries downloads after a fetch failure', async () => {
    const { context, downloads, decodes } = createApp()
    const result = context.preloadSongAudioBuffers('Test')
    await tick()
    downloads[0].resolve({ ok: false, status: 404 })
    finishDownload(downloads[1])
    finishDownload(downloads[2])
    await tick()
    decodes.forEach(({ resolve }) => resolve('decoded'))
    await assert.rejects(result, /Could not fetch .*: 404/)

    const retry = context.preloadSongAudioBuffers('Test')
    await tick()
    assert.equal(downloads.length, 6)
    downloads.slice(3).forEach(finishDownload)
    await tick()
    decodes.slice(2).forEach(({ resolve }) => resolve('decoded'))
    assert.equal((await retry).length, 3)
})
