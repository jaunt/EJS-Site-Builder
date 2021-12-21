// postGenerate.js is called after all generation is complete
// so that we can write any site data based on the results of all generations
//
// It must resolve asynchronously
// or reject on failure.
//
// Inputs:
//  output -> information about all files written to output
//
// Outputs:
//
// site: list of json serializable objects which will created as json files
//            for the purposes of loading in to the web site's runtime javascript code

const path = require("path");

// hack to make sure we get the same output on every test
let all = [];
for (let key in output) {
  all.push(...Object.entries(output[key]));
}

resolve({
  siteFiles: {
    "multipage2.json": all.length,
  },
});
