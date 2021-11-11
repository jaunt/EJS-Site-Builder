const test = (clifry) => {
  return new Promise(async function (resolve, reject) {
    const testRun = clifry.start(
      {
        name: "Simple Test 1",
        description: "Make sure a simple template outputs properly.",
        timeout: 5000,
      },
      [
        "--input ./templates",
        "--output ./output",
        "--cache ./cache",
        "--noWatch",
      ]
    );

    const exitCode = await testRun.stopped();

    if (exitCode) {
      // for this test, the cli must end gracefully
      reject("The cli ended unexpectedly");
    } else {
      try {
        const options = { compareSize: true, compareContents: true };
        const result = clifry.dircompare.compareSync(
          "./output",
          "./expected",
          options
        );
        if (result.same) {
          resolve();
        } else {
          clifry.log(result);
          reject("Output did not match expected.");
        }
      } catch (error) {
        clifry.log(error);
        reject("Test threw an error");
      }
    }
  });
};

module.exports = test;
