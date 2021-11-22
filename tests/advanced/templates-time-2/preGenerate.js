// preGenerate.js is called before anything else
// so that we can build up any global data we want to pass to all
// generator functions.
//
// It must resolve asynchronously
// or reject on failure.
//
// global.js has access to
// cache: a javascript object scripts can use to cache data that can be json.stringified
//
// Outputs:
//
// global: object which can be accessed from any generate script, including "filter" funtions.
//
// site: list of json serializable objects which will created as json files
//            for the purposes of loading in to the web site's runtime javascript code
const now = "2021-nov-15";
const version = 1.4;

const toLowerCase = function (text) {
  return text.toLowerCase() + " hellos";
};

resolve({
  siteFiles: {
    "/version.json": {
      createdDate: now,
      version: version,
    },
  },
  global: {
    date: now,
    toLowerCase: toLowerCase,
  },
});
