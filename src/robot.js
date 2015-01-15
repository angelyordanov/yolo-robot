#!/usr/bin/env node

'use strict';
/*jshint globalstrict:true*/
/*global require, console, process*/

    //node modules
var crypto = require('crypto'),
    fs = require('fs'),
    path = require('path'),
    http = require('http'),

    //npm modules
    _ = require('lodash'),
    express = require('express'),
    gitPromise = require('git-promise'),
    q = require('q'),
    JsonDB = require('node-json-db'),
    
    //local
    GitRepo = require('./gitRepo'),

    //vars
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

function doBuild(starting) {
  function fetch() {
    console.log('fetching repo...');
    return repo.fetchAndPruneLocalOnly().then(function () {
      console.log('repo fetched');
    });
  }

  function build(branch) {
    //init build history
    db.push('/buildHistory', [], false);
    
    var buildHistory = db.getData('/buildHistory'),
        hash = repo.branches[branch].localHash,
        lastBuild,
        result,
        i;
    
    for (i = buildHistory.length - 1; i >= 0; i--) {
      if (buildHistory[i].branch === branch) {
        lastBuild = buildHistory[i];
        break;
      }
    }
    
    if (lastBuild &&
      (!starting || lastBuild.succeeded) && //build failed branches on startup
      lastBuild.hash === hash
    ) {
      console.log('no changes in branch \'' + branch + '\'');
      return q(0);
    }

    console.log('building branch \'' + branch + '\'...');
    try {
      result = q.when(yolofile.build(branch, hash));
    } catch (err) {
      result = q.reject(err);
    }
    
    return result.then(function (res) {
      if (res) {
        console.log('built succeeded for branch \'' + branch + '\'!');
        db.push('/buildHistory', [{
          branch: branch,
          hash: hash,
          succeeded: true,
          result: res
        }], false);
      } else {
        console.log('built skipped for branch \'' + branch + '\'!');
      }
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

  function createBranchBuilder(branch) {
    return function () {
      return _.reduce([
        _.bind(repo.resetHardToRemote, repo, branch),
        _.partial(build, branch)
      ], q.when, q(0));
    };
  }

  return fetch().then(function () {
    return _(repo.branches)
      .keys()
      .map(createBranchBuilder)
      .reduce(q.when, q(0));
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
  return doBuild(true);
}).then(function () {
  var app = express();

  //digest the body
  app.use(function (req, res, next) {
    var hmac = crypto.createHmac('sha1', config.webhooksSecret);

    req.on('data', function (data) {
      hmac.update(data);
    });

    req.on('end', function () {
      req.sha1HexDigest = hmac.digest('hex');
      next();
    });
  });
  
  //handle github webhook posts
  app.post('/' + config.webhooksPath, function (req, res) {
    //verify signature
    if (req.get('X-Hub-Signature') !== 'sha1=' + req.sha1HexDigest) {
      console.log('webhook called but signature verification failed!');
      res.writeHead(500, {'Content-Type': 'text/plain'});
      res.end('Signatures didn\'t match!');
      return;
    }
    
    console.log('webhook called');
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end();

    //chain a build
    next = next.then(function () {
      return doBuild(false);
    });

    //throw any errors caught during build
    next.done();
  });
  
  //handle any errors
  app.use(function (err, req, res, next) {
    if (!err) {
      return next();
    }
    //log thrown exceptions
    console.log(err);
  });
  
  //start server
  http.createServer(app).listen(config.webhooksPort, function () {
    console.log(
      'robot webhooks listening on port ' + config.webhooksPort +
      ' and path \'/' + config.webhooksPath + '\'');
  });
});

//throw any errors caught during launch
next.done();
