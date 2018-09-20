import getLogger from 'loglevel-colored-level-prefix'
import bitcore from 'bitcore-lib'
import { peer as fcoin_Peer, netaddress as NetAddress, packets as Packets } from 'fcoin'

const packet_types = Packets.types

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

		// Default to not open
		this.open = false

		this.best_height = 0

		this.headerSyncComplete = false
		this.headers = []
		this.lastHeaderHash = "4384f467a9af8b7fa3efac8b36691be6bd4fca289935ce06a5a69a191b0e9f9e"
	}
	startup(){
		// Setup the logger
		this.log = getLogger({prefix: "Peer", level: this.options.log_level})

		// Create the Fcoin Peer
		this.internal_peer = fcoin_Peer.fromOptions({
			network: 'main',
			agent: 'SpartanSense v0.0.1',
			hasWitness: () => {
				return false;
			}
		});

		let address = NetAddress.fromHostname((this.options.ip.v4 || this.options.ip.v6) + ":" + this.options.port)

		// Add events
		this.internal_peer.on("packet", this.onPacket.bind(this))
		this.internal_peer.on("open", this.onOpen.bind(this))
		this.internal_peer.on("error", this.onError.bind(this))

		// Connect to peer
		this.internal_peer.connect(address)
		this.internal_peer.tryOpen()
	}
	onPacket(packet){
		switch(packet.type){
			case packet_types.ADDR:
				this.onAddresses(packet)
				return
			case packet_types.HEADERS:
				this.onHeaders(packet)
				return
		}

		this.log.debug(`${packet.cmd} event!`)
	}
	onOpen(info, two, three){
		this.open = true
		this.log.info(`<Peer Open! ${this.getInfoString()} />`)

		this.requestAddresses()
		this.requestHeaders()
	}
	onError(msg){
		this.log.error("Error! ",msg)
	}
	onHeaders(headers_message){
		let headers = headers_message.items

		if (headers.length === 2000)
			this.headers = []

		let lastHeader

		for (let header of headers){
			if (header){
				this.headers.push(header)
				lastHeader = header
			}
		}

		if (!lastHeader){
			this.headerSyncComplete = true
			this.log.info(`<Peer Header Sync Complete lastHash={${this.lastHeader.rhash("hex")}} ${this.getInfoString()} />`)
		} else {
			this.lastHeader = lastHeader
			this.lastHeaderHash = lastHeader.hash('hex')

			let lastHeaderDate = new Date(lastHeader.time * 1000)
			lastHeaderDate = lastHeaderDate.getFullYear() + "-" + (lastHeaderDate.getMonth() + 1) + "-" + lastHeaderDate.getDate()

			this.log.debug(`<Peer Recieved ${headers.length} Headers lastTime={${lastHeaderDate}} ${this.getInfoString()} />`)
			this.requestHeaders()
		}
	}
	onAddresses(addr_message){
		let addresses = addr_message.items || []

		if (addresses.length === 0)
			return

		this.log.info(`Recieved ${addresses.length} Address(es)`)

		for (var address of addresses)
			if(this.options.onAddress)
				this.options.onAddress({ ip: { v4: address.host }, port: address.port })
	}
	onVersion(version_message){
		this.best_height = version_message.startHeight
		this.subversion = version_message.subversion
		this.version = version_message.version

		// this.log.debug(`<Peer height={${this.best_height}} subversion={${this.subversion}} />`)
	}
	requestHeaders(){
		this.internal_peer.sendGetHeaders([this.lastHeaderHash]);
	}
	requestAddresses(){
		this.internal_peer.sendGetAddr()
	}
	isOpen(){
		return this.open
	}
	getHash(){
		return sha256(new Buffer(this.options.ip.v6 + this.options.ip.v4 + this.options.port)).toString('hex')
	}
	getInfoString(){
		return `version={${this.internal_peer.version}} height={${this.internal_peer.bestHeight}} agent={${this.internal_peer.agent}} ip={${this.internal_peer.hostname()}}`
	}
}

export default Peer