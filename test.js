const assert = require('assert')
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tesults = require('tesults')
const packageVersion = require('./package.json').version
const reporter = require('./index')

const originalOutputFile = process.env.TESULTS_OUTPUT_FILE
const originalResults = tesults.results
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'newman-reporter-tesults-'))

let uploads = []

const reset = () => {
    delete process.env.TESULTS_OUTPUT_FILE
    uploads = []
    tesults.results = (data, callback) => {
        uploads.push(data)
        callback(null, {
            success: true,
            message: 'mock upload',
            warnings: [],
            errors: []
        })
    }
}

const summary = () => ({
    collection: {
        name: 'API collection',
        items: {
            members: [{
                id: 'folder-1',
                name: 'Accounts',
                items: {
                    members: [
                        { id: 'passing-item' },
                        { id: 'failing-item' },
                        { id: 'skipped-item' },
                        { id: 'no-assertions-item' }
                    ]
                }
            }]
        }
    },
    run: {
        executions: [
            {
                item: { id: 'passing-item', name: 'gets an account' },
                request: { method: 'GET', url: '/accounts/1' },
                response: { code: 200, responseTime: 12, responseSize: 42 },
                assertions: [{ assertion: 'status is 200' }]
            },
            {
                item: { id: 'failing-item', name: 'rejects a bad account' },
                request: { method: 'GET', url: '/accounts/bad' },
                response: { code: 200, responseTime: 8, responseSize: 31 },
                assertions: [{
                    assertion: 'status is 404',
                    error: { name: 'AssertionError', message: 'expected 200 to equal 404' }
                }]
            },
            {
                item: { id: 'skipped-item', name: 'skips an account check' },
                request: { method: 'GET', url: '/accounts/2' },
                response: { code: 200, responseTime: 6, responseSize: 28 },
                assertions: [{ assertion: 'later check', skipped: true }]
            },
            {
                item: { id: 'no-assertions-item', name: 'has no assertions' },
                request: { method: 'GET', url: '/health' },
                response: { code: 204, responseTime: 4, responseSize: 0 }
            }
        ]
    }
})

const runReporter = (options, doneSummary = summary(), error = null) => {
    const emitter = new EventEmitter()
    reporter(emitter, options, {})

    for (const execution of doneSummary.run.executions) {
        emitter.emit('beforeItem', null, { item: execution.item })
        emitter.emit('item', null, { item: execution.item })
    }

    emitter.emit('done', error, doneSummary)
}

try {
    reset()
    runReporter({ target: 'token' })

    assert.strictEqual(uploads.length, 1)
    assert.strictEqual(uploads[0].target, 'token')
    assert.deepStrictEqual(uploads[0].metadata, {
        integration_name: 'newman-reporter-tesults',
        integration_version: packageVersion,
        test_framework: 'newman'
    })
    assert.strictEqual(uploads[0].results.cases.length, 4)

    const [passing, failing, skipped, noAssertions] = uploads[0].results.cases
    assert.strictEqual(passing.suite, 'Accounts - API collection')
    assert.strictEqual(passing.name, 'gets an account')
    assert.strictEqual(passing.result, 'pass')
    assert.strictEqual(passing._request.method, 'GET')
    assert.strictEqual(passing._response.code, 200)
    assert.strictEqual(passing['_Response time'], 12)
    assert.strictEqual(passing['_Response size'], 42)
    assert.strictEqual(typeof passing.start, 'number')
    assert.strictEqual(typeof passing.end, 'number')

    assert.strictEqual(failing.result, 'fail')
    assert.deepStrictEqual(failing.reason, [{
        name: 'AssertionError',
        message: 'expected 200 to equal 404'
    }])
    assert.strictEqual(skipped.result, 'unknown')
    assert.strictEqual(noAssertions.result, 'pass')

    reset()
    const outputOnlyFile = path.join(temporaryDirectory, 'nested', 'results.json')
    process.env.TESULTS_OUTPUT_FILE = outputOnlyFile
    runReporter({
        buildName: 'build-42',
        buildResult: 'pass',
        buildDescription: 'main branch',
        buildReason: 'completed'
    })

    assert.strictEqual(uploads.length, 0)
    const outputOnlyData = JSON.parse(fs.readFileSync(outputOnlyFile, 'utf8'))
    assert.strictEqual(outputOnlyData.target, '')
    assert.strictEqual(outputOnlyData.metadata.integration_version, packageVersion)
    assert.deepStrictEqual(outputOnlyData.results.cases[0], {
        suite: '[build]',
        name: 'build-42',
        result: 'pass',
        desc: 'main branch',
        reason: 'completed'
    })
    assert.strictEqual(outputOnlyData.results.cases.length, 5)

    reset()
    const combinedFile = path.join(temporaryDirectory, 'combined.json')
    process.env.TESULTS_OUTPUT_FILE = combinedFile
    runReporter({ target: 'combined-token' })

    assert.strictEqual(uploads.length, 1)
    assert.strictEqual(uploads[0].target, 'combined-token')
    assert.strictEqual(JSON.parse(fs.readFileSync(combinedFile, 'utf8')).target, '')

    reset()
    runReporter({})
    assert.strictEqual(uploads.length, 0)

    reset()
    process.env.TESULTS_OUTPUT_FILE = '   '
    runReporter({ target: null })
    assert.strictEqual(uploads.length, 0)

    reset()
    const errorOutputFile = path.join(temporaryDirectory, 'error.json')
    process.env.TESULTS_OUTPUT_FILE = errorOutputFile
    runReporter({}, summary(), new Error('Newman run error'))
    assert.strictEqual(uploads.length, 0)
    assert.strictEqual(fs.existsSync(errorOutputFile), false)

    reset()
    process.env.TESULTS_OUTPUT_FILE = temporaryDirectory
    assert.throws(
        () => runReporter({}),
        /EISDIR|illegal operation on a directory|is a directory/i
    )

    console.log('All Newman Tesults reporter tests passed.')
} finally {
    tesults.results = originalResults
    if (originalOutputFile === undefined) {
        delete process.env.TESULTS_OUTPUT_FILE
    } else {
        process.env.TESULTS_OUTPUT_FILE = originalOutputFile
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
