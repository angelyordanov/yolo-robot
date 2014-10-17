#!/usr/bin/env node

'use strict';
/*jshint globalstrict:true*/
/*global require, console, process*/

var express = require('express'),
    fs = require('fs'),
    path = require('path'),
    gitPromise = require('git-promise'),
    q = require('q'),
    GitRepo = require('./gitRepo'),
    JsonDB = require('node-json-db'),
    
    app = express(),
    http = require('http'),
    yolofile = require(path.join(process.cwd(), 'yolofile.js')),
    config = yolofile.config,
    cloneDir = config.cloneDir,
    repo = new GitRepo(cloneDir),
    db = new JsonDB('yolodb.json', true, true),
    cloned,
    next;

if (fs.existsSync(cloneDir)) {
  if (fs.statSync(cloneDir).isDirectory()) {
    //if the directory exists and is not empty
    //asume that it is a cloned repo and continue
    cloned = fs.readdirSync(cloneDir).length > 0;
  } else {
    console.log('cloneDir exists but it is not a directory');
    process.exit(1);
  }
} else {
  cloned = false;
}

function fetch() {
  console.log('fetching repo...');
  return repo.fetch().then(function () {
    console.log('repo fetched');
  });
}

function prepare(branch) {
  return repo.checkout(branch).then(function () {
    return repo.resetHardToRemote(branch);
  });
}

function build(branch) {
  //init build history
  db.push('/buildHistory', [], false);
  
  var buildHistory = db.getData('/buildHistory'),
      lastBuild = buildHistory[buildHistory.length - 1],
      hash = repo.branches[branch].localHash,
      result;
  
  if (lastBuild &&
    lastBuild.succeeded &&
    lastBuild.hash === hash
  ) {
    console.log('no changes in branch \'' + branch + '\'');
    return q(0);
  }

  console.log('building branch \'' + branch + '\'...');
  try {
    result = q.when(yolofile.build(branch, hash, buildHistory));
  } catch (err) {
    result = q.reject(err);
  }
  
  return result.then(function (res) {
    console.log('built succeeded for branch \'' + branch + '\'!');
    db.push('/buildHistory', [{
      branch: branch,
      hash: hash,
      succeeded: true,
      result: res
    }], false);
  }, function (err) {
    console.log('built failed for branch \'' + branch + '\'!');
    console.log(err);
    
    //make Error serializable
    if (err.constructor.prototype === Error.prototype) {
      err = {
        message: err.message,
        stack: err.stack
      };
    }
    
    db.push('/buildHistory', [{
      branch: branch,
      hash: hash,
      succeeded: false,
      error: err
    }], false);
  });
}

function doBuild() {
  return fetch().then(function () {
    return prepare(config.branch);
  }).then(function () {
    return build(config.branch);
  });
}

next = q(0);

next = next.then(function () {
  if (!cloned) {
    console.log('cloning repo...');
    return gitPromise('clone ' + config.repository + ' ' + cloneDir).then(function () {
      console.log('repo cloned');
    });
  } else {
    console.log('dir not empty, assuming repo cloned');
  }
}).then(function () {
  return doBuild();
}).then(function () {
  app.post('/' + config.webhooksPath, function (req, res) {
    console.log('webhook called');
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end();

    next = next.then(function () {
      return doBuild();
    }).done();//throw any errors caught during build
  });
  app.use(function (err, req, res, next) {
    if (!err) {
      return next();
    }
    //log thrown exceptions
    console.log(err);
  });
  http.createServer(app).listen(config.webhooksPort, function () {
    console.log(
      'robot webhooks listening on port ' + config.webhooksPort +
      ' and path \'/' + config.webhooksPath + '\'');
  });
});

//throw any errors caught during launch
next.done();
