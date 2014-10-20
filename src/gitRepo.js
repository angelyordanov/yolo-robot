'use strict';
/*jshint globalstrict:true*/
/*global require, module, console*/

var _ = require('lodash'),
    q = require('q'),
    gitPromise = require('git-promise');

function GitRepo(dir) {
  this._dir = dir;
  this._git = function (command) {
    return gitPromise(command, { cwd: dir }, function (stdout, code) {
      if (code) {
        throw new Error(stdout);
      }
      return stdout;
    });
  };
  this._chain = function (next) {
    if (!this._next) {
      this._next = this._git('status').then(undefined, function () {
        throw new Error('cloneDir is not a git repo');
      });
    }
    
    this._next = this._next.then(next);
    return this._next;
  };
}

GitRepo.prototype.fetchAndPruneLocalOnly = function () {
  var self = this;
  
  this._chain(function () {
    return self._git('fetch --all -p');
  });
  
  this._updateBranchInfo();
  
  //detach head
  this._chain(function () {
    return self._git('checkout HEAD~1').then(function () {
      _.forEach(self.branches, function (b) {
        b.isCurrent = false;
      });
    });
  });
  
  //delete all local branches that do not have a remote
  return this._chain(function () {
    return _(self.branches)
      .omit(function (b) { return b.remoteHash; })
      .keys()
      .map(function (b) {
        return function () {
          console.log('deleting local branch \'' + b + '\'');
          return self._git('branch -D ' + b);
        };
      //chain all 'git branch -D' promises sequentially
      }).reduce(q.when, q(0)).then(function () {
        self.branches = _.omit(self.branches, function (b) {
          return !b.remoteHash;
        });
      });
  });
};

GitRepo.prototype._initBranchInfo = function () {
  if (!this.branches) {
    this._updateBranchInfo();
  }
  return this._next;
};

GitRepo.prototype._updateBranchInfo = function () {
  var branches = this.branches = {},
      git = this._git;

  return this._chain(function () {
    return git('branch').then(function (localBranches) {
      return _(localBranches.split('\n'))
        .map(function (b) { return b.trim(); })
        .filter(function (b) { return b !== ''; })
        .map(function (b) {
          var isCurrent = false;
          if (b.indexOf('*') === 0) {
            b = b.substr(1).trim();
            isCurrent = true;
          }
          
          branches[b] = {
            localHash: undefined,
            remoteHash: undefined,
            isCurrent: isCurrent
          };
          
          //map each branch to a function returning a rev-parse promise
          return function () {
            return git('rev-parse ' + b).then(function (hash) {
              branches[b].localHash = hash.trim();
            });
          };
        }).reduce(q.when, q(0));//chain all 'git rev-parse' promises sequentially
    }).then(function () {
      return git('branch --remote');
    }).then(function (remoteBranches) {
      return _(remoteBranches.split('\n'))
        .map(function (b) { return b.trim(); })
        .filter(function (b) {
          return b !== '' && b.indexOf('origin/HEAD') !== 0;
        }).map(function (remoteBranch) {
          var branch = remoteBranch.split('/')[1];
          if (!branches[branch]) {
            branches[branch] = {
              localHash: undefined,
              remoteHash: undefined,
              isCurrent: false
            };
          }
          
          return function () {
            return git('rev-parse ' + remoteBranch).then(function (hash) {
              branches[branch].remoteHash = hash.trim();
            });
          };
        }).reduce(q.when, q(0));
    });
  });
};

GitRepo.prototype.checkout = function (branch) {
  var self = this;
  this._initBranchInfo();
  return this._chain(function () {
    var b = self.branches[branch];
    if (!b) {
      throw new Error('no such branch \'' + branch + '\' in the repository');
    }
    
    if (b.isCurrent) {
      return;
    }
    
    return self._git('checkout ' + branch).then(function () {
      _.forEach(self.branches, function (b) {
        b.isCurrent = false;
      });
      b.isCurrent = true;
    });
  });
};

GitRepo.prototype.resetHardToRemote = function (branch) {
  var self = this;
  this._initBranchInfo();
  return this._chain(function () {
    var b = self.branches[branch];
    if (!b) {
      throw new Error('no such branch \'' + branch + '\' in the repository');
    }
    
    if (b.localHash === b.remoteHash) {
      return;
    }

    return self._git('reset --hard origin/' + branch).then(function () {
      b.localHash = b.remoteHash;
    });
  });
};

module.exports = GitRepo;
