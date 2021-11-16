// postGenerate.js is called after all generation is complete
// so that we can write any site data based on the results of all generations
//
// It must resolve asynchronously
// or reject on failure.
//
// Inputs:
//  outData -> information about all files written to output
//
// Outputs:
//
// site: list of json serializable objects which will created as json files
//            for the purposes of loading in to the web site's runtime javascript code

resolve({
  siteFiles: {
    "multipage.json": {
      output,
    },
  },
});
