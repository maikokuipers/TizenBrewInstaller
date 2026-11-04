"use strict";

var fetch = require('node-fetch');
function fetchLatestRelease(repo) {
  var url = "https://api.github.com/repos/".concat(repo, "/releases/latest");
  return fetch(url).then(function (response) {
    if (!response.ok) {
      throw new Error("GitHub API error: ".concat(response.statusText));
    }
    return response.json();
  }).then(function (data) {
    return data;
  });
}
module.exports = {
  fetchLatestRelease: fetchLatestRelease
};