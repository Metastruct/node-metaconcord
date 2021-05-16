import schedule from "node-schedule";
import config from "motd.json";
import axios from "axios";

import { Service } from "@/app/services";
import { Container } from "@/app/Container";

export default class Motd extends Service {
    name = "Motd";
    messages: Array<string>;
    
    constructor(container: Container) {
		super(container);
        this.messages = [];
        schedule.scheduleJob('0 12 * * *', this.executeJob);
    }

    pushMessage(msg: string): void {
        this.messages.push(msg);
    }
    
    private executeJob(): void {
        if (this.messages.length <= 0) return;

        const msg: string = this.messages[Math.floor(Math.random() * this.messages.length)];
        this.messages = [];
        if (msg == null || msg.length === 0) return;

        axios.post(config.webhook, msg);
    }
}