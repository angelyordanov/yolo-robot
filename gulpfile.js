'use strict';
/*jshint globalstrict:true*/
/*global require, console*/

var gulp = require('gulp'),
    jscs = require('gulp-jscs'),
    jshint = require('gulp-jshint'),
    files = ['./yolofile.js', './src/*.js'];

gulp.task('jscs', function () {
  gulp.src(files)
    .pipe(jscs())
    .on('error', function (err) {
      console.log(err.message);
    });
});

gulp.task('lint', function () {
  gulp.src(files)
    .pipe(jshint('.jshintrc'))
    .pipe(jshint.reporter('jshint-stylish'));
});

gulp.task('default', ['lint', 'jscs']);
