#!/usr/bin/env node

// Functional Airfry Testing.

// Run airfry for each input test and compare against expected outputs.
// use -nw option to end after generating files.

/*

https://nodejs.org/api/child_process.html

var exec = require('child_process').exec;
function execute(command, callback){
    exec(command, function(error, stdout, stderr){ callback(stdout); });
};

const { exec } = require('child_process');
const controller = new AbortController();
const { signal } = controller;
const child = exec('grep ssh', { signal }, (error) => {
  console.log(error); // an AbortError
});
controller.abort();

*/