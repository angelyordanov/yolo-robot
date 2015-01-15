'use strict';
/*jshint globalstrict:true*/
/*global require, exports, process*/

var _ = require('lodash'),
    q = require('q'),
    path = require('path'),
    exec = require('child_process').exec;

exports.config = {
  webhooksPort: 3637,
  webhooksPath: 'webhooks',
  webhooksSecret: 'secret',
  repository: 'git@github.com:angelyordanov/eumis.git',
  cloneDir: './repo'
};

exports.build = function (branch, hash) {
  if (branch === 'master') {
    return buildMaster(hash);
  } else if (branch === 'design') {
    return buildDesign(hash);
  }

  return false; //skip
};

function command(cmd, cwd) {
  return function () {
    var deferred = q.defer(),
        child = exec(
          cmd,
          { cwd: path.join(exports.config.cloneDir, cwd) },
          deferred.makeNodeResolver());

    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    
    return deferred.promise;
  };
}

function buildMaster(hash) {
  var smallhash = hash.substr(0, 6);
  
  return _.reduce([
    command('CreateAll.bat', './src/Eumis.Database'),
    command('CreateAll.bat', './src/Eumis.Blob.Database'),
    command('.\\.nuget\\nuget.exe restore eumis.sln', './src'),
    command('npm install', './src'),
    command('bower install', './src/Eumis.Web.App'),
    command('gulp package-ci', './src/Eumis.Web.App'),
    command('gulp package-ci', './src/Eumis.Blob.Host'),
    command('gulp package-ci', './src/Eumis.PortalIntegration.Host'),
    command('eumis.deploy.cmd /Y', './src/build/eumis1.0.0.0#' + smallhash),
    command('eumis_blob.deploy.cmd /Y', './src/build/eumis1.0.0.0#' + smallhash),
    command('eumis_portal_integration.deploy.cmd /Y', './src/build/eumis1.0.0.0#' + smallhash)
  ], q.when, q(0)).spread(function (stdout, stderr) {
    if (stderr) {
      //msdeploy will not return a non-zero error code
      //informing 'exec' that the command failed
      //but will just print some text on the stderrr
      throw new Error(stderr);
    }
    
    return true;
  });
}

function buildDesign(hash) {
  var smallhash = hash.substr(0, 6);
  
  return _.reduce([
    command('sqlcmd -S. -v dbName="Eumis_design" -i"CreateAll.sql"', './src/Eumis.Database'),
    command('.\\.nuget\\nuget.exe restore eumis.sln', './src'),
    command('npm install', './src'),
    command('bower install', './src/Eumis.Web.App'),
    command('gulp package-debug', './src/Eumis.Web.App'),
    command('eumis.deploy.cmd /Y ' +
      '"-setParam:name=\'IIS Web Application Name\',value=\'Eumis_design\'" ' +
      '"-setParam:name=\'DbContext-Web.config Connection String\',value=\'Data Source=.\\;Initial Catalog=Eumis_design;Integrated Security=True;MultipleActiveResultSets=True\'"',
      './src/build/eumis1.0.0.0#' + smallhash)
  ], q.when, q(0)).spread(function (stdout, stderr) {
    if (stderr) {
      //msdeploy will not return a non-zero error code
      //informing 'exec' that the command failed
      //but will just print some text on the stderrr
      throw new Error(stderr);
    }
    
    return true;
  });
}