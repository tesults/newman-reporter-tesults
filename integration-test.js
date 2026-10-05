const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const externalNewmanPath = process.env.NEWMAN_MODULE_PATH
const newman = require(externalNewmanPath || 'newman')
const packageVersion = require('./package.json').version

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'newman-reporter-tesults-integration-'))
const outputFile = path.join(temporaryDirectory, 'nested', 'results.json')
const reporterLink = path.join(__dirname, 'node_modules', 'newman-reporter-tesults')
const uploadTarget = process.env.TESULTS_TARGET_TOKEN
const uploadOnly = Boolean(uploadTarget && process.env.TESULTS_UPLOAD_ONLY === 'true')
let createdReporterLink = false

const server = http.createServer((request, response) => {
    const body = JSON.stringify({ ok: true, path: request.url })
    response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
    })
    response.end(body)
})

const listen = () => new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve(server.address().port)
    })
})

const close = () => new Promise(resolve => server.close(resolve))

const collection = port => ({
    info: {
        name: 'Newman reporter fixture',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: [{
        name: 'Accounts',
        item: [
            {
                name: 'reports a passing request',
                request: {
                    method: 'GET',
                    url: `http://127.0.0.1:${port}/passing`
                },
                event: [{
                    listen: 'test',
                    script: {
                        exec: [
                            "pm.test('status is 200', function () {",
                            '  pm.response.to.have.status(200);',
                            '});'
                        ]
                    }
                }]
            },
            {
                name: 'reports a failing request',
                request: {
                    method: 'GET',
                    url: `http://127.0.0.1:${port}/failing`
                },
                event: [{
                    listen: 'test',
                    script: {
                        exec: [
                            "pm.test('status is 404', function () {",
                            '  pm.response.to.have.status(404);',
                            '});'
                        ]
                    }
                }]
            },
            {
                name: 'reports a skipped assertion',
                request: {
                    method: 'GET',
                    url: `http://127.0.0.1:${port}/skipped`
                },
                event: [{
                    listen: 'test',
                    script: {
                        exec: ["pm.test.skip('future assertion', function () {});"]
                    }
                }]
            },
            {
                name: 'reports a request without assertions',
                request: {
                    method: 'GET',
                    url: `http://127.0.0.1:${port}/no-assertions`
                }
            }
        ]
    }]
})

const run = options => new Promise((resolve, reject) => {
    newman.run(options, (error, summary) => {
        if (error) {
            reject(error)
            return
        }
        resolve(summary)
    })
})

;(async () => {
    try {
        if (!externalNewmanPath && !fs.existsSync(reporterLink)) {
            fs.symlinkSync(__dirname, reporterLink, 'dir')
            createdReporterLink = true
        }

        if (!uploadOnly) process.env.TESULTS_OUTPUT_FILE = outputFile
        const port = await listen()
        const runSummary = await run({
            collection: collection(port),
            reporters: ['tesults'],
            reporter: {
                tesults: uploadTarget ? { target: uploadTarget } : {}
            },
            suppressExitCode: true
        })

        assert.strictEqual(runSummary.run.failures.length, 1)

        if (uploadOnly) {
            console.log('Newman target-only integration test completed.')
            return
        }

        assert.ok(fs.existsSync(outputFile))

        const data = JSON.parse(fs.readFileSync(outputFile, 'utf8'))
        assert.strictEqual(data.target, '')
        assert.deepStrictEqual(data.metadata, {
            integration_name: 'newman-reporter-tesults',
            integration_version: packageVersion,
            test_framework: 'newman'
        })
        assert.strictEqual(data.results.cases.length, 4)
        assert.ok(data.results.cases.every(testCase => testCase.suite === 'Accounts - Newman reporter fixture'))

        const passing = data.results.cases.find(testCase => testCase.name === 'reports a passing request')
        const failing = data.results.cases.find(testCase => testCase.name === 'reports a failing request')
        const skipped = data.results.cases.find(testCase => testCase.name === 'reports a skipped assertion')
        const noAssertions = data.results.cases.find(testCase => testCase.name === 'reports a request without assertions')

        assert.strictEqual(passing.result, 'pass')
        assert.strictEqual(failing.result, 'fail')
        assert.match(JSON.stringify(failing.reason), /expected response to have status code 404 but got 200/i)
        assert.strictEqual(skipped.result, 'unknown')
        assert.strictEqual(noAssertions.result, 'pass')
        assert.strictEqual(typeof passing.start, 'number')
        assert.strictEqual(typeof passing.end, 'number')

        console.log('Newman CLI integration test passed.')
    } finally {
        delete process.env.TESULTS_OUTPUT_FILE
        if (server.listening) await close()
        if (createdReporterLink) fs.unlinkSync(reporterLink)
        fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    }
})().catch(error => {
    console.error(error)
    process.exitCode = 1
})
