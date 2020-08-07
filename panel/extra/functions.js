const http = require('http');

function httpRequest(method, path, body) {
  return new Promise ((resolve, reject) => {
    var options = {
      socketPath: '/var/run/docker.sock',
      path: path,
      method: method
    };
    if(typeof body != "undefined") {
      options.headers = {
          'Content-Type': 'application/json'
      };
    }
    var req = http.request(options, function(res) {
      res.setEncoding('utf8');
      var rawData = '';
      res.on('data', chunk => {
        rawData += chunk;
      });
      res.on('end', () => {
        resolve(rawData);
      });
    });

    req.on('error', err => {
      reject(err);
    });

    if(typeof body != "undefined") {
      req.write(JSON.stringify(body))
    }
    req.end();
  });
}

function isInteger(integer, min, max) {
  integer = Math.floor(integer);
  if(!integer) {
    return false;
  }
  if(typeof min !== "undefined" && isInteger(min) && integer < min) {
    return false;
  }
  if(typeof max !== "undefined" && isInteger(max) && integer > max) {
    return false;
  }
  return true;
}

function isValidPort(port) {
  return isInteger(port,1,65535);
}

module.exports = {
  isInteger: isInteger,
  isValidPort: isValidPort,
  httpRequest: httpRequest
};
