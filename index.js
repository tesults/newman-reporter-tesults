// Reference https://learning.postman.com/docs/running-collections/using-newman-cli/newman-custom-reporters/
const tesults = require('tesults')

module.exports = function (emitter, reporterOptions, collectionRunOptions) {
    // emitter is an event emitter that triggers the following events: https://github.com/postmanlabs/newman#newmanrunevents
    // reporterOptions is an object of the reporter specific options. See usage examples below for more details.
    // collectionRunOptions is an object of all the collection run options: https://github.com/postmanlabs/newman#newmanrunoptions-object--callback-function--run-eventemitter

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

        if (reporterOptions.target === undefined || reporterOptions.target === null) {
            console.log("Tesults target is missing from reporter options. Tesults reporter will be disabled and not submit results.")
            return;
        }

        let data_submit = {
            target: reporterOptions.target,
            results: {
                cases: []
            }
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
    })
}