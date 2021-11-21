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

// hack to make sure we get the same output on every test
let all = [];
for (let key in output) {
  all.push(...Object.entries(output[key]));
}
all = all.map((pair) => {
  return { page: pair[0], path: pair[1] };
});
all.sort((a, b) => a.page.localeCompare(b.page));

resolve({
  siteFiles: {
    "multipage.json": all,
  },
});
