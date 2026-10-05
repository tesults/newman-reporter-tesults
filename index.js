// Reference https://learning.postman.com/docs/running-collections/using-newman-cli/newman-custom-reporters/
const tesults = require('tesults')
const fs = require('fs')
const path = require('path')
const packageVersion = require('./package.json').version

const readableReason = (reason) => {
    if (!Array.isArray(reason)) { return reason }

    return reason.map((error) => {
        if (typeof error === 'string') { return error }
        if (error && typeof error.stack === 'string') { return error.stack }
        if (error && typeof error.message === 'string') { return error.message }
        try {
            return JSON.stringify(error)
        } catch (err) {
            return String(error)
        }
    }).filter(Boolean).join('\n\n')
}

module.exports = function (emitter, reporterOptions = {}, collectionRunOptions) {
    // emitter is an event emitter that triggers the following events: https://github.com/postmanlabs/newman#newmanrunevents
    // reporterOptions is an object of the reporter specific options. See usage examples below for more details.
    // collectionRunOptions is an object of all the collection run options: https://github.com/postmanlabs/newman#newmanrunoptions-object--callback-function--run-eventemitter

    const outputFile = typeof process.env.TESULTS_OUTPUT_FILE === 'string'
        ? process.env.TESULTS_OUTPUT_FILE.trim()
        : ''
    const hasTarget = reporterOptions.target !== undefined && reporterOptions.target !== null

    let times = {}

    emitter.on('beforeItem', (error, args) => {
        try {
            times[args.item.id] = {start: Date.now(), end: undefined}
        } catch (err) {
            // Ignore
        }
    })

    emitter.on('item', (error, args) => {
        try {
            times[args.item.id].end = Date.now()
        } catch (err) {
            // Ignore
        }
    })

    emitter.on('done', (error, args) => {
        const data = args
        if (error) {
            // Handle error
            console.log("Tesults reporter unable to process results due to error from Newman emitter:")
            console.log(error)
            return
        }

        if (!hasTarget && outputFile === '') {
            console.log("Tesults target is missing from reporter options and TESULTS_OUTPUT_FILE is not set. Tesults reporter will be disabled.")
            return;
        }

        let data_submit = {
            target: reporterOptions.target,
            results: {
                cases: []
            },
            metadata: {
                integration_name: "newman-reporter-tesults",
                integration_version: packageVersion,
                test_framework: "newman"
            }
        }

        // Build information
        const buildName = reporterOptions["buildName"]
        const buildDescription = reporterOptions["buildDescription"]
        const buildResult = reporterOptions["buildResult"]
        const buildReason = reporterOptions["buildReason"]
        if (buildName !== undefined) {
            let buildCase = {suite: "[build]", name: buildName, result: "unknown"}
            if (buildResult !== undefined) {
                if (buildResult === "pass" || buildResult === "fail") {
                    buildCase.result = buildResult
                }
            }
            if (buildDescription !== undefined) {
                buildCase.desc = buildDescription
            }
            if (buildReason !== undefined) {
                buildCase.reason = buildReason
            }
            data_submit.results.cases.push(buildCase)
        }
        
        const caseHash = {}
        // Get assertions/ test case details
        if (data.run !== undefined) {
            if (data.run.executions !== undefined) {
                for (let i = 0; i < data.run.executions.length; i++) {
                    let execution = data.run.executions[i]
                    let testCase = {
                        suite: data.collection.name,
                        name: execution.item.name,
                        result: "pass"
                    }
                    if (execution.assertions !== undefined) {
                        for (let j = 0; j < execution.assertions.length; j++) {
                            let assertion = execution.assertions[j]
                            if (assertion.error !== undefined) {
                                testCase.result = "fail"
                                if (testCase.reason === undefined) {
                                    testCase.reason = [assertion.error]
                                } else {
                                    testCase.reason.push(assertion.error)
                                }
                            }
                            if (assertion.skipped === true) {
                                testCase.result = "unknown"
                            }
                        }
                    }
                    try {
                        testCase["start"] = times[execution.item.id].start
                    } catch (err) {
                        testCase["start"] = undefined
                    }
                    try {
                        testCase["end"] = times[execution.item.id].end
                    } catch (err) {
                        testCase["end"] = undefined
                    }
                    try {
                        testCase["_request"] = execution.request
                    } catch (err) {
                        testCase["_request"] = "Unable to parse request"
                    }
                    try {
                        testCase["_response"] = execution.response
                    } catch (err) {
                        testCase["_response"] = "Unable to parse response"
                    }
                    try {
                        testCase["_item"] = execution.item
                    } catch (err) {
                        testCase["_item"] = "Unable to parse item"
                    }
                    try {
                        testCase["_assertions"] = execution.assertions
                    } catch (err) {
                        testCase["_assertions"] = "Unable to parse assertions"
                    }
                    try {
                        testCase["_Response time"] = execution.response.responseTime
                        testCase["_Response size"] = execution.response.responseSize
                    } catch (err) {
                        // Omit
                    }
                    caseHash[execution.item.id] = data_submit.results.cases.length
                    data_submit.results.cases.push(testCase)
                }
            }
        }

        // Apply folder names to suite
        for (let i = 0; i < data.collection.items.members.length; i++) {
            let member = data.collection.items.members[i]
            if (member.items !== undefined) { // Check if member is a group (folder)
                if (member.items.members !== undefined) {
                    for (let j = 0; j < member.items.members.length; j++) {
                        let item = member.items.members[j]
                        if (caseHash[item.id] !== undefined) {
                            let index = caseHash[item.id]
                            let suite = data_submit.results.cases[index].suite
                            data_submit.results.cases[index].suite = member.name + " - " + suite
                        }
                    }
                }
            }
        }
        
        if (outputFile !== '') {
            const outputData = JSON.parse(JSON.stringify(Object.assign({}, data_submit, {target: ""})))
            outputData.results.cases.forEach((testCase) => {
                testCase.reason = readableReason(testCase.reason)
            })
            fs.mkdirSync(path.dirname(outputFile), {recursive: true})
            fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2))
            console.log('Tesults results written to ' + outputFile)
        }

        if (hasTarget) {
            tesults.results(data_submit, (err, response) => {
                if (err) {
                    console.log('Error: ' + err);
                } else {
                    console.log('Success: ' + response.success);
                    console.log('Message: ' + response.message);
                    console.log('Warnings: ' + response.warnings.length);
                    console.log('Errors: ' + response.errors.length);
                }
            })
        }
    })
}
