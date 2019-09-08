'use strict';

class Dispatcher {
  constructor(connection, protocol) {
    const that = this;
    this._connection = connection;
    this._id = 0;
    this._protocol = protocol;
    this._connection.on('message', (msg) => {
      that._handleMessage(JSON.parse(msg));
    });

    this._resolvers = {};
    this._rejectors = {};
    this._domainListeners = {};

    this._parameterMap = {};

    // create method parameter index
    protocol.domains.forEach(({domain, commands}) => {
      that._parameterMap[domain] = {};
      commands.forEach(({name, parameters}) => {
        that._parameterMap[domain][name] = {};

        if (parameters === undefined) {
          // command takes no parameters
          return false;
        }

        parameters.forEach((parameter) => {
          that._parameterMap[domain][name][parameter.name] = parameter;
        });
      });
    });
  }

  _validateParams(namespace, method, params) {
    if (!this._parameterMap[namespace]) {
      return {error: `unknown namespace: ${namespace}`};
    }

    if (!this._parameterMap[namespace][method]) {
      return {error: `unknown method: ${namespace}.${method}`};
    }

    const knownParams = this._parameterMap[namespace][method];

    if (Object.keys(knownParams).length === 0) {
      // method does not require any arguments
      return {error: 0};
    }

    const missingParams = [];
    Object.entries(knownParams).forEach(([paramName, paramDef]) => {
      const param = params[paramName];
      const optional = paramDef.optional;
      if (optional !== true && typeof(param) === 'undefined') {
        missingParams.push(paramName);
      }
    });

    if (missingParams.length > 0) {
      return {
        error: `${method} requires '${missingParams.join(',')}' parameter`,
      };
    }

    return {error: 0};
  }

  _handleMessage(message) {
    if (message.id) {
      if (message.error) {
        const rejector = this._rejectors[message.id];
        if (rejector) {
          rejector(message.error.message);
        }
      }
      else {
        const resolver = this._resolvers[message.id];
        if (resolver) {
          resolver(message.result);
        }
      }

      delete this._resolvers[message.id];
      delete this._rejectors[message.id];
      return true;
    }

    const method = message.method;
    const dotIndex = method.indexOf('.');
    const domain = method.substr(0, dotIndex);
    const prop = method.substr(dotIndex + 1);

    if (this._domainListeners[domain]) {
      const handlers = this._domainListeners[domain];
      handlers.forEach((handler) => {
        handler(prop, message.params);
      });
    }
  }

  registerDomainListener(name, handler) {
    this._domainListeners[name] = this._domainListeners[name] || [];
    this._domainListeners[name].push(handler);
  }

  getDomainEventNames(name) {
    const {events} = this.getDomainDefinition(name);
    const evNames = [];
    if (events instanceof Array) {
      events.forEach((eventInfo) => {
        evNames.push(eventInfo.name);
      });
    }
    return evNames;
  }

  getDomainCommandNames(name) {
    return Object.keys(this.getDomainCommands(name));
  }

  getDomainCommands(name) {
    const {commands} = this.getDomainDefinition(name);
    const commandMap = {};
    commands.forEach(({name, parameters}) => {
      commandMap[name] = {parameters};
    });

    return commandMap;
  }

  getDomainDefinition(name) {
    const {domains} = this._protocol;
    for (let x = 0; x < domains.length; x++) {
      const def = domains[x];
      if (def.domain === name) {
        return def;
      }
    }

    return null;
  }

  async send(namespace, method, params = {}) {
    const validation = this._validateParams(namespace, method, params);
    if (validation.error) {
      throw new Error(validation.error);
    }

    const that = this;
    this._id++;
    this._connection.send(JSON.stringify({
      id: this._id,
      method: `${namespace}.${method}`,
      params,
    }));

    return new Promise((resolve, reject) => {
      this._resolvers[that._id] = resolve;
      this._rejectors[that._id] = reject;
    });
  }
}

exports.Dispatcher = Dispatcher;
