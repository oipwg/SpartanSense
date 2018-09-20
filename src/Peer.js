import getLogger from 'loglevel-colored-level-prefix'
import bitcore, { Networks, BlockHeader } from 'bitcore-lib'
import { Messages, Peer as bitcore_Peer } from 'bitcore-p2p'
const sha256 = bitcore.crypto.Hash.sha256

class Peer {
	/**
	 * Create a new SpartanSense Peer
	 * @param  {Object} options - The options to create the peer on
	 * @param  {Object} options.network - The network object to use for everything
	 * @param  {Object} options.ip - The ip object containing either a v4 or v6 ip
	 * @param  {String} options.ip.v4 - The v4 ip of the Peer
	 * @param  {String} [options.ip.v6] - The v6 ip of the Peer, included if v4 is empty
	 * @param  {Number} [options.port] - The port of the Peer
	 * @param  {String} [options.log_level] - A "loglevel" logger to log to
	 * @param {Function} [options.onAddress] - A function to be run each time a new address is announced to the Peer
	 * @return {Peer}
	 */
	constructor(options){
		this.options = options

		// Enforce required options
		if (!this.options.network)
			throw new Error("The Network option is required on Peer")
		if (!this.options.ip)
			throw new Error("The IP option is required on Peer")
		if (!this.options.ip.v4 && !this.options.ip.v6)
			throw new Error("Either a v4 or v6 IP is required!")

		// Setup the port if not defined
		if (!this.options.port)
			this.options.port = this.options.network.port

		if (!this.options.log_level)
			this.options.log_level = "silent"

		this.messages = new Messages({network: this.options.network})

		// Default to not ready
		this.ready = false

		this.best_height = 0
	}
	startup(){
		// Setup the logger
		this.log = getLogger({prefix: "Peer", level: this.options.log_level})

		// Create the Bitcore Peer
		this.internal_peer = new bitcore_Peer({
			host: this.options.ip.v4 || this.options.ip.v6,
			port: this.options.port,
			messages: this.messages,
			network: this.options.network,
			relay: true
		})

		let PeerEvents = ['inv', 'getdata', 'ping', 'pong',
			'getaddr', 'verack', 'reject', 'alert', 'headers', 'block', 'merkleblock',
			'tx', 'getblocks', 'getheaders', 'error', 'filterload', 'filteradd',
			'filterclear'
		];

		// Add events
		this.internal_peer.on("connect", this.onConnect.bind(this))
		this.internal_peer.on("ready", this.onReady.bind(this))
		this.internal_peer.on("version", this.onVersion.bind(this))
		this.internal_peer.on("getheaders", this.onHeaders.bind(this))
		this.internal_peer.on("inv", this.onInv.bind(this))
		this.internal_peer.on("addr", this.onAddresses.bind(this))
		
		PeerEvents.forEach((event) => {
			this.internal_peer.on(event, (message) => { this._event(event, message)})
		})

		// Connect to peer
		this.internal_peer.connect()
	}
	_event(event, data){
		this.log.debug(`${event} event!`)

		// if (event === "error")
		// 	console.log(`${event} event! `, data)
	}
	onConnect(){
		// this.log.debug(`Peer Connected! ${this.getInfoString()}`)
		this.connected = true

		// console.log(this.messages)
		this.internal_peer.sendMessage(this.messages.Version({
			version: 70002,
			subversion: "/SpartanSense 0.0.1/"
		}))
	}
	onReady(info, two, three){
		this.ready = true
		this.log.info(`<Peer Ready! ${this.getInfoString()} />`)

		this.requestAddresses()
	}
	onError(one, two, three){
		this.log.error("Peer Connection Error ",one, two, three)
	}
	onInv(inv_message){
		this.log.debug("Recieved Inv ", inv_message)
	}
	onHeaders(getheaders_message){
		let raw_headers = getheaders_message.starts
		let headers = []

		for (let raw of raw_headers){
			// let header = BlockHeader.fromBuffer(raw)
			// let header = raw.toString("hex")
			// headers.push(header)
		}
		// this.log.debug("Recieved getheaders ", headers)
	}
	onAddresses(addr_message){
		let ips = []
		let addresses = addr_message.addresses || []

		if (addresses.length === 0)
			return

		this.log.info(`Recieved ${addresses.length} Addresses`)

		for (var address of addresses)
			if(this.options.onAddress)
				this.options.onAddress(address)
	}
	onVersion(version_message){
		this.best_height = version_message.startHeight
		this.subversion = version_message.subversion

		// this.log.debug(`<Peer height={${this.best_height}} subversion={${this.subversion}} />`)
	}
	requestRecentHeaders(){}
	requestAddresses(){
		this.internal_peer.sendMessage(this.messages.GetAddr())
	}
	isReady(){
		return this.ready
	}
	getHash(){
		return sha256(new Buffer(this.options.ip.v6 + this.options.ip.v4 + this.options.port)).toString('hex')
	}
	getInfoString(){
		return `height={${this.best_height}} subversion={${this.subversion}} ip={${(this.options.ip.v4 || this.options.ip.v6) + ":" + this.options.port}}`
	}
}

export default Peer