// require config
const fs = require('fs');
const isValidDomain = require('is-valid-domain');
const fn = require('./extra/functions');
const log = require('./extra/log');
const isIp = require('is-ip');
const {exec, spawn} = require('child_process');
const http = require('http');
const isPortReachable = require('is-port-reachable');

// vars config
const configPath = './config/dockade.json';
const rinetdConfigPath = '/etc/rinetd.conf';

// require router et proxy
const https = require('https');
const tls = require('tls');
const httpProxy = require('http-proxy');
const proxy = httpProxy.createProxy();
const schedule = require('node-schedule');

// Regénération des certificats
schedule.scheduleJob('0 */12 * * *', function(){
  log.debug("Execution de 'certbot renew'")
  exec("certbot renew", (error, stdout, stderr) => {
    if (error) {
      log.error("certbot renew : "+error.message);
      return;
    }
    if (stderr) {
      log.error("certbot renew : "+stderr);
      return;
    }
    log.info("certbot renew : "+stdout);
  });
});

// vars router et proxy
var vhosts, vhosts_https;

// config
async function reloadConfig() {
  vhosts = {};
  vhosts_https = [];
  log.title("Chargement du fichier de config")
  try {
    if(!fs.existsSync(configPath)) {
      throw new Error('Fichier de config absent');
    }
    var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch(e) {
    log.error(e.message)
    return false;
  }

  try {
    var portsOutList = [];
    for (const proj of config) {
      if(typeof proj.domain === "undefined") {
        throw new Error("Un domaine n'est pas indiqué");
      } else if(!isValidDomain(proj.domain)) {
        throw new Error("Le domaine "+proj.domain+" est invalide");
      }
      if(typeof proj.port === "undefined") {
        throw new Error("Le port du domaine "+proj.domain+" n'est pas indiqué");
      } else if(!fn.isValidPort(proj.port)) {
        throw new Error("Le port du domain "+proj.domaine+" est invalide");
      }
      if(typeof proj.ports !== "undefined") {
        for (const portOut in proj.ports) {
          if(portsOutList.includes(portOut)) {
            throw new Error("Le port "+portOut+" ne peut être utilisé qu'une seule fois");
          }
          portsOutList.push(portOut);
        }
      }
    }
    log.info("Config valide")
  } catch(e) {
    log.error(e.message)
    return false;
  }

  //Reset de la config rinetd
  fs.writeFileSync(rinetdConfigPath, '');

  var containers = {};
  var containersBoucles = [];

  await fn.httpRequest('GET','/containers/json?all=true').then((res)=> {
    res = JSON.parse(res);
    if(res.length > 0) {
      // Parcours des containers
      res.forEach((el) => {
        if(el.Names.length > 0) {
          containers[el.Names[0].replace('/','')] = {
            ip: el.NetworkSettings.Networks.bridge.IPAddress,
            state: el.State,
            id: el.Id
          };
        }
      });
    }
  });

  var traitements = [];
  //Parcours des projets de la config
  for (const proj of config) {
    traitements.push(new Promise((resolve, reject) => {
     return new Promise((resolve, reject) => { // Projet
        return new Promise((resolve, reject) => { // Ip
          containersBoucles.push(proj.domain);
          if(containers.hasOwnProperty(proj.domain)) {
            var container = containers[proj.domain];
            if(container.state === 'exited') {
              return new Promise((resolve, reject) => {
                fn.httpRequest('POST', '/containers/'+container.id+'/start').then((res) => {
                  fn.httpRequest('GET', '/containers/'+container.id+'/json').then((res) => {
                    res = JSON.parse(res);
                    resolve(res.NetworkSettings.IPAddress);
                  });
                });
              }).then(r => resolve(r));
            } else if(container.state !== 'running') {
              reject('Container dans un état non pris en charge ('+container.state+')');
            } else {
              resolve(container.ip);
            }
          } else {
            return new Promise((resolve, reject) => {
              fn.httpRequest('POST','/containers/create?name='+proj.domain, {'Image':'dockade', 'Domainname':proj.domain}).then((res) => {
                res = JSON.parse(res);
                if(typeof res.Id === "undefined") {
                  reject(res.message);
                } else {
                  fn.httpRequest('POST', '/containers/'+res.Id+'/start').then((resStart) => {
                    fn.httpRequest('GET', '/containers/'+res.Id+'/json').then((resInspect) => {
                      resInspect = JSON.parse(resInspect);
                      resolve(resInspect.NetworkSettings.IPAddress);
                    });
                  });
                }
              });
            })
            .then(r => resolve(r))
            .catch(e => reject(e));
          }
        }).then((ip) => {
          return new Promise((resolve, reject) => { // Vhost
            return isPortReachable(proj.port, {host: ip}).then((isReachable) => {
              if(!isIp(ip)) {
                reject("L'ip du domaine "+proj.domain+" est invalide ("+ip+")")
              } else if(!isReachable) {
                log.warn('Le port '+proj.port+' du domaine '+proj.domain+' est inaccessible');
                resolve();
              } else {
                vhosts[proj.domain] = {ip:ip, port:proj.port};
                if(typeof proj.https !== "undefined") {
                  if(proj.https === "on") {
                    var privkeyPath = '/etc/letsencrypt/live/'+proj.domain+'/privkey.pem';
                    var certPath = '/etc/letsencrypt/live/'+proj.domain+'/cert.pem';
                    if(!fs.existsSync(privkeyPath) || !fs.existsSync(certPath)) {
                      log.warn("Certificat ssl non trouvé pour le domaine "+proj.domain);
                    } else {
                      vhosts_https.push(proj.domain);
                    }
                  }
                }
                resolve();
              }
            })
            .then(() => resolve())
            .catch(e => reject(e));
          }).then(() => { // Ports
            var configPorts = '';
            for (const portOut in proj.ports) {
              configPorts += '0.0.0.0 '+portOut+' '+ip+' '+proj.ports[portOut]+'\n';
            }
            fs.appendFileSync(rinetdConfigPath, configPorts);
            resolve();
          })
          .catch(e => reject(e));
        }).then(() => resolve());
      })
      .then(r => resolve(r))
      .catch(err => {
        log.error(err);
        resolve('erreur(s)');
      });
    }));
  }

  return await Promise.all(traitements).then(() => {
    Object.keys(containers).filter(x => !containersBoucles.includes(x)).forEach(proj => {
      log.warn("Le container "+proj+" n'est pas ou plus présent dans la config");
    });
    exec('service rinetd reload');
    log.info("Config chargée");
    return true;
  });
}

fs.watchFile(configPath, () => {
  reloadConfig();
});
reloadConfig();

// router et proxy
function specialRouting(req, res) {
  if(req.url.startsWith('/.well-known/acme-challenge/')) { // Partie SSL
    var acmeChallengeFilePath = '/var/www/data/.well-known/acme-challenge'+req.url.replace('.well-known/acme-challenge/','');
    if (fs.existsSync(acmeChallengeFilePath) && fs.statSync(acmeChallengeFilePath).isFile()) {
      fs.createReadStream(acmeChallengeFilePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.write('http 404');
      res.end();
    }
    return true;
  }
  return false;
}

http.createServer(function (req, res) {
  var vhost = vhosts[req.headers.host];
  if(isIp(req.headers.host)) {
    res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
    res.write("Bienvenue sur dockade !");
    res.end();
  } else if(typeof vhost !== "undefined") {
    if(vhosts_https.includes(req.headers.host)) {
      res.writeHead(301,{Location: 'https://' + req.headers.host + req.url});
      res.end();
    } else if(!specialRouting(req, res)) {
      proxy.web(req, res, {target:'http://'+vhost.ip+':'+vhost.port});
    }
  } else {
    res.writeHead(404, {"Content-Type": "text/html; charset=utf-8"});
    res.write("Ce container n'existe pas ou n'est pas configuré !");
    res.end();
  }
}).listen(80);

function getDomainCert(domain) {
  var privkeyPath = '/etc/letsencrypt/live/'+domain+'/privkey.pem';
  var certPath = '/etc/letsencrypt/live/'+domain+'/cert.pem';
  if(!fs.existsSync(privkeyPath) || !fs.existsSync(certPath)) {
    return "no certificate";
  }
  return tls.createSecureContext({
    key: fs.readFileSync(privkeyPath),
    cert: fs.readFileSync(certPath)
  });
}

https.createServer({
  SNICallback: function (domain, cb) {
    var cert = getDomainCert(domain);
    if(typeof cert === "string") {
      cb(null, cert);
    } else {
      cb(null, cert);
    }
  },
  cert: fs.readFileSync('/var/www/data/panel_cert.pem'),
  key: fs.readFileSync('/var/www/data/panel_key.pem')
}, function (req, res) {
  if(!vhosts_https.includes(req.headers.host)) {
    res.writeHead(301, {Location: 'http://' + req.headers.host + req.url});
    res.end();
    return;
  }
  var vhost = vhosts[req.headers.host];
  if(!specialRouting(req, res)) {
    proxy.web(req, res, {target:'http://'+vhost.ip+':'+vhost.port});
  }
}).listen(443);
