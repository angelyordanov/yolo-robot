'use strict';
/*jshint globalstrict:true*/
/*global require, exports, process*/

var _ = require('lodash'),
    q = require('q'),
    path = require('path'),
    exec = require('child_process').exec;

exports.config = {
  webhooksPort: 9000,
  webhooksPath: 'webhooks',
  repository: 'https://angelyordanov@github.com/angelyordanov/eumis.git',
  branch: 'master',
  cloneDir: './repo'
};

exports.build = function (branch, hash, buildHistory) {
  var smallhash = hash.substr(0, 6);

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
  
  return _.reduce([
    command('npm install', './src'),
    command('bower install', './src/Eumis.Web.App'),
    command('gulp package-debug', './src/Eumis.Web.App'),
    command('eumis1.0.0.0#' + smallhash + '.deploy.cmd /Y' + 
            ' "-setParam:name=\'IIS Web Application Name\',value=\'Eumis/\'"' +
            ' "-setParam:name=\'DbContext-Web.config Connection String\',value=' +
              '\'Data Source=.\\;' +
              'Initial Catalog=Eumis;' +
              'Integrated Security=True;' +
              'MultipleActiveResultSets=True\'"',
      './src/build/eumis')
  ], q.when, q(0)).spread(function (stdout, stderr) {
    if (stderr) {
      throw new Error(stderr);
    }
  });
};