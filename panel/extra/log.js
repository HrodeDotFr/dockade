const chalk = require('chalk');

module.exports = {
  error: message => console.log(chalk.red(message)),
  warn: message => console.log(chalk.yellow(message)),
  info: message => console.log(chalk.blue(message)),
  debug: message => console.log(chalk.green(message)),
  title: message => console.log(chalk.inverse(message))
};
