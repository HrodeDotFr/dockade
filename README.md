# Dockade

Techno utilisée : nodejs  
Dockade est un gestionnaire de container docker pensé pour rendre ce dernier plus pratique et rapide à utiliser.

## Installation

```sh
apt-get update
apt-get upgrade
apt-get install sudo apt-transport-https ca-certificates curl gnupg-agent software-properties-common
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo apt-key add -
add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/debian $(lsb_release -cs) stable"
apt-get update
apt-get install docker-ce docker-ce-cli containerd.io
apt-get install rinetd certbot openssl
cd /var/www/
git clone git@github.com:HrodeDotFr/dockade.git
mkdir -p .well-known/acme-challenge/
openssl req -x509 -newkey rsa:4096 -keyout panel_key.pem -out panel_cert.pem -days 3650
cd /var/www/panel/dockerfiles
docker build -t dockade .
cd /var/www/panel/
npm i
```

Lancer le serveur dans la console
```sh
node index.js
```
Lancer la console en fond
```sh
pm2 start index.js
```

## Utilisation

- Pour créer des containers, il faut juste modifier le fichier de config (panel/config/dockade.json).
Il est possible de modifier le fichier de config lorsque le serveur nodejs est lancé, il mettra à jour la configuration tout seul.

- Un nouveau container créé avec dockade aura pour identifiant ssh root et root.

- Pour activer le https sur un container
  ```sh
  certbot certonly -n -a webroot --webroot-path /var/www/data/ -d {domaine.extension}
  ```

- Pour supprimer un certificat (/etc/letsencrypt/live/), utiliser cette commande, et ne pas supprimer à la main le dossier du domaine
  ```sh
  certbot delete
  ```

### Config

```json
[
    {
        "domain":"domaine.extension",
        "port":80,
        "https":"on",
        "ports":{
           "9122":"22"
        }
    },
    {
        "domain":"autre-domaine.extension",
        "port":"3000"
    }
]
```

**domain**  
Domaine sur lequel le container sera disponible
(bien penser à faire la redirection dns vers l'ip du serveur)

**port**  
Port d'écoute du serveur http

**https**  
'on' pour activer le https, autre sinon

**ports**  
Redirections de ports
Sous la forme *port du serveur <-> port du container*
