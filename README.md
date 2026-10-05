# Newman Tesults Reporter

Report Postman collection results from Newman to [Tesults](https://www.tesults.com), or write them to a file for the Tesults test automation reporting GitHub Action.

## Installation

```sh
npm install --save-dev newman-reporter-tesults
```

## Direct upload

Run Newman with the Tesults reporter and your target token:

```sh
newman run your_collection.json -r tesults --reporter-tesults-target token
```

The reporter retains Postman folder names as Tesults suite names and includes request, response, assertion, response-time, and response-size data.

## GitHub Actions output

Place the action before the Newman step and omit the target token:

```yaml
- name: Set up test automation reporting
  uses: tesults/test-automation-reporting@v1

- name: Run Postman collection
  run: npx newman run your_collection.json -r tesults
```

The action supplies `TESULTS_OUTPUT_FILE` to Newman and renders the report after the job completes. No Tesults token or account is required.

When both `--reporter-tesults-target` and `TESULTS_OUTPUT_FILE` are provided, the reporter writes the local file and retains the existing direct upload behavior. The local file always contains an empty target so credentials are never written into the artifact.

## Build result

Existing build options remain supported:

```sh
newman run your_collection.json -r tesults \
  --reporter-tesults-target token \
  --reporter-tesults-buildName build-42 \
  --reporter-tesults-buildResult pass \
  --reporter-tesults-buildDescription "main branch"
```

## Documentation

Newman and Postman documentation is available at [tesults.com/docs/postman](https://www.tesults.com/docs/postman).

## Testing

```sh
npm test
```

## Support

Email help@tesults.com.
