var Service, Characteristic;
var mqtt = require('mqtt');

module.exports = function (homebridge) {
    Service = homebridge.hap.Service
    Characteristic = homebridge.hap.Characteristic
    homebridge.registerAccessory("homebridge-mqtt-dehumidifier", "MqttDehumidifier", MqttDehumidifier)
}

const POWER_ON = 'ON'
const POWER_OFF = 'OFF'

class MqttDehumidifier {

    constructor(log, config) {
        this.log = log
        this.name = config.name || 'Dehumidifier'

        this.mqttUrl = config['mqttUrl']
        this.client_Id = 'mqttjs_' + Math.random().toString(16).substr(2, 8)

        this.powerTopic = config['powerTopic'] || 'sonoff/humidifier/value/POWER'
        this.powerCommandTopic = config['powerCommandTopic'] || 'sonoff/humidifier/value/cmnd/POWER'
        this.humidityTopic = config['humidityTopic'] || 'home/humidity/value'
        this.refreshHumidityTopic = config['refreshHumidityTopic'] || null
        this.refreshHumidityMinutesInterval = config['refreshHumidityMinutesInterval'] || 15

        this.client = mqtt.connect(this.mqttUrl)
        this.client.subscribe(this.powerTopic)
        this.client.subscribe(this.humidityTopic)

        this.client.publish(this.powerCommandTopic, POWER_ON, null)
        this.power = POWER_ON
        this.isActive = true
        this.currentHumidifierState = Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING
        this.relativeHumidityHumidifierThreshold = 45;
        this.relativeHumidityDehumidifierThreshold = 60;

        this.service = new Service.HumiditySensor(this.name)

        this.services = []

        this.service = new Service.HumidifierDehumidifier(this.name)

        this.service
            .getCharacteristic(Characteristic.Active)
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this))

        this.service
            .getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState)
            .on('get', this.getCurrentHumidifierState.bind(this))

        this.service
            .getCharacteristic(Characteristic.TargetHumidifierDehumidifierState)
            .setValue(Characteristic.TargetHumidifierDehumidifierState.AUTO)

        this.service
            .getCharacteristic(Characteristic.CurrentRelativeHumidity)
            .on('get', this.getCurrentRelativeHumidity.bind(this))

        this.service
            .getCharacteristic(Characteristic.RelativeHumidityHumidifierThreshold)
            .on('get', this.getRelativeHumidityHumidifierThreshold.bind(this))
            .on('set', this.setRelativeHumidityHumidifierThreshold.bind(this))

        this.service
            .getCharacteristic(Characteristic.RelativeHumidityDehumidifierThreshold)
            .on('get', this.getRelativeHumidityDehumidifierThreshold.bind(this))
            .on('set', this.setRelativeHumidityDehumidifierThreshold.bind(this))

        this.services.push(this.service)

        var self = this;

        this.client.on('message', function (topic, message) {
            switch (topic) {
                case self.powerTopic:
                    self.log.debug("Power topic message: " + message);

                    self.power = POWER_OFF
                    self.currentHumidifierState = Characteristic.CurrentHumidifierDehumidifierState.INACTIVE

                    if (message == POWER_ON) {
                        self.currentHumidifierState = Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING
                        self.power = POWER_ON
                    }

                    self.service.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState)
                        .updateValue(self.currentHumidifierState)
                    break;
                case self.humidityTopic:
                    self.log.debug("Humidity topic message: " + message);

                    self.humidity = parseFloat(JSON.parse(message).humidity);
                    self.service.getCharacteristic(Characteristic.CurrentRelativeHumidity).updateValue(self.humidity);

                    if (!self.isActive) {
                        break;
                    }

                    var power = self.power

                    if (self.humidity < self.relativeHumidityHumidifierThreshold) {
                        self.log.debug("Humidity Humidifier Threshold reached: " + self.relativeHumidityHumidifierThreshold);
                        power = POWER_OFF
                    } else if (self.humidity > self.relativeHumidityDehumidifierThreshold) {
                        self.log.debug("Humidity Dehumidifier Threshold reached: " + self.relativeHumidityDehumidifierThreshold);
                        power = POWER_ON
                    }

                    if (power !== self.power) {
                        self.client.publish(self.powerCommandTopic, power, null)
                    }
                    break;
                default:
                    this.log.error("Unknown topic: " + topic + "message: " + message);
                    break;
            }
        })

        if (this.refreshHumidityTopic) {
            setInterval(function () {
                if (self.isActive) {
                    self.client.publish(self.refreshHumidityTopic, 'refresh');
                }
            }, this.refreshHumidityMinutesInterval * 60 * 1000);
        }

    }

    getServices() {
        return this.services
    }

    async getActive(callback) {
        this.log.debug("Get Active called: " + this.isActive);

        callback(
            null,
            this.isActive
                ? Characteristic.Active.ACTIVE
                : Characteristic.Active.INACTIVE
        )
    }

    async setActive(state, callback) {
        this.log.debug("Set Active called: " + state);

        this.isActive = (state === Characteristic.Active.ACTIVE)

        if (this.isActive) {
            this.client.publish(this.refreshHumidityTopic, 'refresh', null, function (error, packet) {
                callback();
            });
        } else {
            this.client.publish(this.powerCommandTopic, POWER_OFF, null, function (error, packet) {
                callback();
            })
        }
    }

    async getCurrentRelativeHumidity(callback) {
        this.log.debug("Get Curent Humidity called: " + this.humidity)

        var self = this

        callback(null, self.humidity)

        if (this.refreshHumidityTopic) {
            this.client.publish(this.refreshHumidityTopic, 'refresh');
        }
    }

    async getCurrentHumidifierState(callback) {
        this.log.debug("Get Curent Humidifier state called: " + this.currentHumidifierState)

        callback(null, this.currentHumidifierState)
    }

    async getRelativeHumidityHumidifierThreshold(callback) {
        this.log.debug("Get Curent Humidity Humidifier Threshold called: " + this.relativeHumidityHumidifierThreshold)

        callback(null, this.relativeHumidityHumidifierThreshold)
    }

    async setRelativeHumidityHumidifierThreshold(value, callback) {
        this.log.debug("Set Curent Humidity Humidifier Threshold called: " + value)

        this.relativeHumidityHumidifierThreshold = value

        callback()

        if (this.refreshHumidityTopic) {
            this.client.publish(this.refreshHumidityTopic, 'refresh');
        }
    }

    async getRelativeHumidityDehumidifierThreshold(callback) {
        this.log.debug("Get Curent Humidity Dehumidifier Threshold called: " + this.relativeHumidityDehumidifierThreshold)

        callback(null, this.relativeHumidityDehumidifierThreshold)
    }

    async setRelativeHumidityDehumidifierThreshold(value, callback) {
        this.log.debug("Set Curent Humidity Dehumidifier Threshold called: " + value)

        this.relativeHumidityDehumidifierThreshold = value

        callback()

        if (this.refreshHumidityTopic) {
            this.client.publish(this.refreshHumidityTopic, 'refresh');
        }
    }
}
