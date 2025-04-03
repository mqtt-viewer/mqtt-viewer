export namespace app {
	
	export class Connection {
	    connectionDetails: models.Connection;
	    isConnected: boolean;
	    eventSet: events.ConnectionEventsSet;
	
	    static createFrom(source: any = {}) {
	        return new Connection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionDetails = this.convertValues(source["connectionDetails"], models.Connection);
	        this.isConnected = source["isConnected"];
	        this.eventSet = this.convertValues(source["eventSet"], events.ConnectionEventsSet);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Connections {
	    connections: {[key: number]: Connection};
	
	    static createFrom(source: any = {}) {
	        return new Connections(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connections = this.convertValues(source["connections"], Connection, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class EnvInfo {
	    isDev: boolean;
	    serverAddress: string;
	    version: string;
	
	    static createFrom(source: any = {}) {
	        return new EnvInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.isDev = source["isDev"];
	        this.serverAddress = source["serverAddress"];
	        this.version = source["version"];
	    }
	}
	export class MqttStats {
	    totalMessagesReceived: number;
	    totalMessagesSent: number;
	    totalBytesReceived: number;
	    totalBytesSent: number;
	    statsByConnection: {[key: number]: mqtt.ConnectionStats};
	
	    static createFrom(source: any = {}) {
	        return new MqttStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalMessagesReceived = source["totalMessagesReceived"];
	        this.totalMessagesSent = source["totalMessagesSent"];
	        this.totalBytesReceived = source["totalBytesReceived"];
	        this.totalBytesSent = source["totalBytesSent"];
	        this.statsByConnection = this.convertValues(source["statsByConnection"], mqtt.ConnectionStats, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PublishProperties {
	    contentType?: string;
	    payloadFormatIndicator: boolean;
	    messageExpiryInterval?: number;
	    topicAlias?: number;
	    responseTopic?: string;
	    correlationData?: string;
	    subscriptionIdentifier?: number;
	    userProperties?: {[key: string]: string};
	
	    static createFrom(source: any = {}) {
	        return new PublishProperties(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.contentType = source["contentType"];
	        this.payloadFormatIndicator = source["payloadFormatIndicator"];
	        this.messageExpiryInterval = source["messageExpiryInterval"];
	        this.topicAlias = source["topicAlias"];
	        this.responseTopic = source["responseTopic"];
	        this.correlationData = source["correlationData"];
	        this.subscriptionIdentifier = source["subscriptionIdentifier"];
	        this.userProperties = source["userProperties"];
	    }
	}
	export class PublishParams {
	    topic: string;
	    qos: number;
	    payload: string;
	    retain: boolean;
	    properties: PublishProperties;
	
	    static createFrom(source: any = {}) {
	        return new PublishParams(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.topic = source["topic"];
	        this.qos = source["qos"];
	        this.payload = source["payload"];
	        this.retain = source["retain"];
	        this.properties = this.convertValues(source["properties"], PublishProperties);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class SavePublishHistoryEntryParams {
	    connectionId: number;
	    topic: string;
	    payload: string;
	    qos: number;
	    retain: boolean;
	    encoding: string;
	    format: string;
	    headerContentType?: string;
	    headerResponseTopic?: string;
	    headerCorrelationData?: string;
	    headerPayloadFormatIndicator?: boolean;
	    headerMessageExpiryInterval?: number;
	    headerTopicAlias?: number;
	    headerSubscriptionIdentifier?: number;
	    userProperties?: string;
	
	    static createFrom(source: any = {}) {
	        return new SavePublishHistoryEntryParams(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.topic = source["topic"];
	        this.payload = source["payload"];
	        this.qos = source["qos"];
	        this.retain = source["retain"];
	        this.encoding = source["encoding"];
	        this.format = source["format"];
	        this.headerContentType = source["headerContentType"];
	        this.headerResponseTopic = source["headerResponseTopic"];
	        this.headerCorrelationData = source["headerCorrelationData"];
	        this.headerPayloadFormatIndicator = source["headerPayloadFormatIndicator"];
	        this.headerMessageExpiryInterval = source["headerMessageExpiryInterval"];
	        this.headerTopicAlias = source["headerTopicAlias"];
	        this.headerSubscriptionIdentifier = source["headerSubscriptionIdentifier"];
	        this.userProperties = source["userProperties"];
	    }
	}
	export class StartupOptions {
	
	
	    static createFrom(source: any = {}) {
	        return new StartupOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
	    }
	}

}

export namespace events {
	
	export enum GlobalEvent {
	    ConnectionDeleted = "ConnectionDeleted",
	    UpdateAvailable = "UpdateAvailable",
	}
	export class ConnectionEventsSet {
	    mqttConnected: string;
	    mqttDisconnected: string;
	    mqttConnecting: string;
	    mqttReconnecting: string;
	    mqttClientError: string;
	    mqttMessages: string;
	    mqttLatency: string;
	    mqttClearHistory: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionEventsSet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mqttConnected = source["mqttConnected"];
	        this.mqttDisconnected = source["mqttDisconnected"];
	        this.mqttConnecting = source["mqttConnecting"];
	        this.mqttReconnecting = source["mqttReconnecting"];
	        this.mqttClientError = source["mqttClientError"];
	        this.mqttMessages = source["mqttMessages"];
	        this.mqttLatency = source["mqttLatency"];
	        this.mqttClearHistory = source["mqttClearHistory"];
	    }
	}

}

export namespace models {
	
	export class PublishHistory {
	    id: number;
	    connectionId: number;
	    topic: string;
	    qos: number;
	    retain: boolean;
	    payload: string;
	    encoding: string;
	    format: string;
	    userProperties?: string;
	    headerContentType?: string;
	    headerResponseTopic?: string;
	    headerCorrelationData?: string;
	    headerPayloadFormatIndicator?: boolean;
	    headerMessageExpiryInterval?: number;
	    headerTopicAlias?: number;
	    headerSubscriptionIdentifier?: number;
	    // Go type: time
	    publishedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new PublishHistory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.connectionId = source["connectionId"];
	        this.topic = source["topic"];
	        this.qos = source["qos"];
	        this.retain = source["retain"];
	        this.payload = source["payload"];
	        this.encoding = source["encoding"];
	        this.format = source["format"];
	        this.userProperties = source["userProperties"];
	        this.headerContentType = source["headerContentType"];
	        this.headerResponseTopic = source["headerResponseTopic"];
	        this.headerCorrelationData = source["headerCorrelationData"];
	        this.headerPayloadFormatIndicator = source["headerPayloadFormatIndicator"];
	        this.headerMessageExpiryInterval = source["headerMessageExpiryInterval"];
	        this.headerTopicAlias = source["headerTopicAlias"];
	        this.headerSubscriptionIdentifier = source["headerSubscriptionIdentifier"];
	        this.publishedAt = this.convertValues(source["publishedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FilterHistory {
	    id: number;
	    connectionId: number;
	    text: string;
	    // Go type: time
	    lastUsed: any;
	
	    static createFrom(source: any = {}) {
	        return new FilterHistory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.connectionId = source["connectionId"];
	        this.text = source["text"];
	        this.lastUsed = this.convertValues(source["lastUsed"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Subscription {
	    id: number;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	    connectionId: number;
	    qos?: number;
	    topic: string;
	    // Go type: null
	    protoDescriptor: any;
	
	    static createFrom(source: any = {}) {
	        return new Subscription(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	        this.connectionId = source["connectionId"];
	        this.qos = source["qos"];
	        this.topic = source["topic"];
	        this.protoDescriptor = this.convertValues(source["protoDescriptor"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Connection {
	    id: number;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	    name: string;
	    mqttVersion: string;
	    hasCustomClientId?: boolean;
	    // Go type: null
	    clientId: any;
	    protocol: string;
	    host: string;
	    port: number;
	    websocketPath: string;
	    // Go type: null
	    username: any;
	    // Go type: null
	    password: any;
	    isProtoEnabled?: boolean;
	    // Go type: null
	    protoRegDir: any;
	    isCertsEnabled?: boolean;
	    skipCertVerification?: boolean;
	    // Go type: null
	    certCa: any;
	    // Go type: null
	    certClient: any;
	    // Go type: null
	    certClientKey: any;
	    subscriptions: Subscription[];
	    // Go type: null
	    lastConnectedAt: any;
	    // Go type: null
	    customIconSeed: any;
	    filterHistories: FilterHistory[];
	    publishHistories: PublishHistory[];
	
	    static createFrom(source: any = {}) {
	        return new Connection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	        this.name = source["name"];
	        this.mqttVersion = source["mqttVersion"];
	        this.hasCustomClientId = source["hasCustomClientId"];
	        this.clientId = this.convertValues(source["clientId"], null);
	        this.protocol = source["protocol"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.websocketPath = source["websocketPath"];
	        this.username = this.convertValues(source["username"], null);
	        this.password = this.convertValues(source["password"], null);
	        this.isProtoEnabled = source["isProtoEnabled"];
	        this.protoRegDir = this.convertValues(source["protoRegDir"], null);
	        this.isCertsEnabled = source["isCertsEnabled"];
	        this.skipCertVerification = source["skipCertVerification"];
	        this.certCa = this.convertValues(source["certCa"], null);
	        this.certClient = this.convertValues(source["certClient"], null);
	        this.certClientKey = this.convertValues(source["certClientKey"], null);
	        this.subscriptions = this.convertValues(source["subscriptions"], Subscription);
	        this.lastConnectedAt = this.convertValues(source["lastConnectedAt"], null);
	        this.customIconSeed = this.convertValues(source["customIconSeed"], null);
	        this.filterHistories = this.convertValues(source["filterHistories"], FilterHistory);
	        this.publishHistories = this.convertValues(source["publishHistories"], PublishHistory);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class PanelSize {
	    id: string;
	    size: number;
	    isOpen: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PanelSize(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.size = source["size"];
	        this.isOpen = source["isOpen"];
	    }
	}
	
	export class SortState {
	    id: string;
	    sortCriteria: string;
	    sortDirection: string;
	
	    static createFrom(source: any = {}) {
	        return new SortState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sortCriteria = source["sortCriteria"];
	        this.sortDirection = source["sortDirection"];
	    }
	}
	
	export class Tab {
	    id: number;
	    tabIndex: number;
	    connectionId: number;
	    connection: Connection;
	
	    static createFrom(source: any = {}) {
	        return new Tab(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.tabIndex = source["tabIndex"];
	        this.connectionId = source["connectionId"];
	        this.connection = this.convertValues(source["connection"], Connection);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace mqtt {
	
	export class ConnectionStats {
	    messagesReceived: number;
	    messagesSent: number;
	    bytesReceived: number;
	    bytesSent: number;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.messagesReceived = source["messagesReceived"];
	        this.messagesSent = source["messagesSent"];
	        this.bytesReceived = source["bytesReceived"];
	        this.bytesSent = source["bytesSent"];
	    }
	}
	export class MessageProperties {
	    correlationData: number[];
	    contentType: string;
	    responseTopic: string;
	    payloadFormat?: number;
	    messageExpiry?: number;
	    subscriptionIdentifier?: number;
	    topicAlias?: number;
	    userProperties: {[key: string]: string};
	
	    static createFrom(source: any = {}) {
	        return new MessageProperties(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.correlationData = source["correlationData"];
	        this.contentType = source["contentType"];
	        this.responseTopic = source["responseTopic"];
	        this.payloadFormat = source["payloadFormat"];
	        this.messageExpiry = source["messageExpiry"];
	        this.subscriptionIdentifier = source["subscriptionIdentifier"];
	        this.topicAlias = source["topicAlias"];
	        this.userProperties = source["userProperties"];
	    }
	}
	export class MqttMessage {
	    id: string;
	    topic: string;
	    payload: number[];
	    qos: number;
	    retain: boolean;
	    properties?: MessageProperties;
	    timeMs: number;
	    middlewareProperties?: {[key: string]: any};
	
	    static createFrom(source: any = {}) {
	        return new MqttMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.topic = source["topic"];
	        this.payload = source["payload"];
	        this.qos = source["qos"];
	        this.retain = source["retain"];
	        this.properties = this.convertValues(source["properties"], MessageProperties);
	        this.timeMs = source["timeMs"];
	        this.middlewareProperties = source["middlewareProperties"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace update {
	
	export class UpdateResponse {
	    machine_id: string;
	    latest_version: string;
	    can_update: boolean;
	    release_notes: string;
	    notification_text: string;
	    notification_url: string;
	    update_url: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.machine_id = source["machine_id"];
	        this.latest_version = source["latest_version"];
	        this.can_update = source["can_update"];
	        this.release_notes = source["release_notes"];
	        this.notification_text = source["notification_text"];
	        this.notification_url = source["notification_url"];
	        this.update_url = source["update_url"];
	    }
	}

}

