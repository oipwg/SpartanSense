import getLogger from 'loglevel-colored-level-prefix'
import bitcore from 'bitcore-lib'
import * as fcoin from 'fcoin'

const fcoin_Peer = fcoin.Peer
const NetAddress = fcoin.net.NetAddress
const Packets = fcoin.packets

const packet_types = Packets.types

const sha256 = bitcore.crypto.Hash.sha256

class Peer {
	/**
	 * Create a new SpartanSense Peer
	 * @param  {Object} options - The options to create the peer on
	 * @param  {Object} options.network - The network object to use for everything
	 * @param  {String} options.ip - Either a v4 or v6 ip address w/ port
	 * @param  {String} [options.log_level] - A "loglevel" logger to log to
	 * @param {Function} [options.onAddress] - A function to be run each time a new address is announced to the Peer
	 * @param {Function} [options.onDisconnect] - A function to be run when the peer has a connection failure
	 * @return {Peer}
	 */
	constructor(options){
		this.options = options

		// Enforce required options
		if (!this.options.network)
			throw new Error("The Network option is required on Peer")
		if (!this.options.ip)
			throw new Error("The IP option is required on Peer")

		if (!this.options.log_level)
			this.options.log_level = "silent"

		// Default to not open
		this.open = false

		this.best_height = 0

		this.lastHeaderHash = this.options.network.lastHeaderHash
		this.headerSyncComplete = false
		this.headers = []

		this.mempool = []

		this.initialSyncComplete = false
		this.requested_blocks = []
		this.blockHeightMap = {}
		this.blockMap = {}
		this.lastBlockHash = undefined
	}
	startup(){
		// Setup the logger
		this.log = getLogger({prefix: "Peer", level: this.options.log_level})

		// Create the Fcoin Peer
		this.internal_peer = fcoin_Peer.fromOptions({
			network: this.options.network.name,
			agent: 'SpartanSense v0.0.1',
			hasWitness: () => {
				return false;
			}
		});

		let address = NetAddress.fromHostname(this.options.ip)

		// Add events
		this.internal_peer.on("packet", this.onPacket.bind(this))
		this.internal_peer.on("open", this.onOpen.bind(this))
		this.internal_peer.on("error", this.onError.bind(this))

		// Connect to peer
		this.internal_peer.connect(address)
		this.internal_peer.tryOpen()
	}
	destroy(){
		this.destroyed = true
		clearInterval(this._requestAddressesInterval)
		delete this.headers
		delete this.blockHeightMap
		delete this.blockMap

		return this.internal_peer.destroy()
	}
	onPacket(packet){
		switch(packet.type){
			case packet_types.INV:
				this.onInventory(packet)
				return
			case packet_types.ADDR:
				this.onAddresses(packet)
				return
			case packet_types.HEADERS:
				this.onHeaders(packet)
				return
			case packet_types.BLOCK:
				this.onBlock(packet)
				return
			case packet_types.TX:
				this.onTX(packet)
				return
		}

		let ignored_events = ["ping", "pong", "sendcmpct", "sendheaders", "getheaders", "feefilter"]

		if (ignored_events.indexOf(packet.cmd) === -1)
			this.log.debug(`${packet.cmd} event!`)
	}
	onOpen(info, two, three){
		this.open = true
		this.log.info(`<Peer Open! ${this.getInfoString()} />`)

		// Request new addresses every 10 seconds
		this._requestAddressesInterval = setInterval(() => {
			if (!this.destroyed && !this.internal_peer.destroyed)
				this.requestAddresses()
		}, 60 * 1000)
		// Request immediately
		// this.requestAddresses()
		this.requestHeaders()
	}
	onError(err){
		// Ignore errors that are not fatal. Don't run `onDisconnect` for these errors
		let ignored_errors = ["Socket Error: ECONNRESET"]
		for (let error_text of ignored_errors)
			if (err.message.includes(error_text))
				return

		// Only log errors sometimes, but always run the `onDisconnect` for these errors
		let dont_log = false
		let dont_log_err = ["Socket Error: ECONNREFUSED", "Socket Error: EHOSTUNREACH", "EPIPE", "Connection timed out.", "Peer is stalling", "Socket hangup."]
		for (let dont_log_err_text of dont_log_err)
			if (err.message.includes(dont_log_err_text))
				dont_log = true
		// Only log the error if we figured out we should
		if (!dont_log)
			this.log.error(err)

		// Send the disconnect for the peer
		if (this.options.onDisconnect)
			this.options.onDisconnect(this.getHash(), this.isOpen())
	}
	onHeaders(headers_message){
		let headers = headers_message.items

		if (headers.length >= 1000)
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
			this.log.debug(`<Peer Header Sync Complete lastHash={${this.lastHeader.rhash("hex")}} ${this.getInfoString()} />`)

			this.lastBlockHash = this.headers[0].hash('hex')
			this.requestBlocks()
		} else {
			this.lastHeader = lastHeader
			this.lastHeaderHash = lastHeader.hash('hex')

			let lastHeaderDate = new Date(lastHeader.time * 1000)
			lastHeaderDate = lastHeaderDate.getFullYear() + "-" + (lastHeaderDate.getMonth() + 1) + "-" + lastHeaderDate.getDate()

			if (headers.length < 2000){
				this.headerSyncComplete = true
				this.log.debug(`<Peer Header Sync Complete lastHash={${this.lastHeader.rhash("hex")}} ${this.getInfoString()} />`)

				this.lastBlockHash = this.headers[0].hash('hex')
				this.requestBlocks()
			} else {
				this.log.debug(`<Peer Recieved ${headers.length} Headers lastHash={${this.lastHeaderHash}} lastTime={${lastHeaderDate}} ${this.getInfoString()} />`)
				this.requestHeaders()
			}
		}
	}
	onAddresses(addr_message){
		let addresses = addr_message.items || []
		addresses = addresses.slice(0, addresses.length)

		if (addresses.length === 0)
			return

		this.log.debug(`Recieved ${addresses.length} Address(es)`)

		let ips = []
		for (let i = 0; i < addresses.length; i++){
			ips.push(addresses[i].hostname)
		}

		for (let ip of ips){
			if(this.options.onAddress)
				this.options.onAddress(ip)
		}
	}
	onInventory(inv_message){
		let items = inv_message.items;

		let txs_to_request = []
		let blocks_to_request = []

		for (let item of items){
			// 1 = mempool tx
			if (item.type === 1){
				txs_to_request.push(item.hash)
			}
			// 2 = Block
			if (item.type === 2){
				blocks_to_request.push(item.hash)
			}
		}

		let sentInfo = false

		if (this.headerSyncComplete && !this.initialSyncComplete && blocks_to_request.length > 1){
			this.requested_blocks = blocks_to_request
			this.internal_peer.getBlock(blocks_to_request)
			sentInfo = true
		}

		if (this.headerSyncComplete && this.initialSyncComplete &&  blocks_to_request.length >= 1 && !sentInfo){
			this.internal_peer.getBlock(blocks_to_request)
			sentInfo = true
		}

		if (txs_to_request.length > 0){
			this.internal_peer.getTX(txs_to_request)
			sentInfo = true
		}

		if (sentInfo)
			return

		// Don't log new block before full sync
		if (items.length === 1 && blocks_to_request.length === 1 && !this.initialSyncComplete)
			return

		this.log.debug("Inventory Message! ", inv_message)
	}
	onTX(tx_message){
		this.mempool.push(tx_message.tx)
		this.log.debug(`<Peer Mempool Transaction txHash={${tx_message.tx.hash("hex")}} ${this.getInfoString()} />`)
	}
	onBlock(block_message){
		let block_height = block_message.block.getCoinbaseHeight()
		let block_hash = block_message.block.hash('hex')
		let rblock_hash = block_message.block.rhash('hex')

		let block_transactions = block_message.block.toBlock().txs

		let tx_index_to_remove = []

		for (let tx of block_transactions){
			// Check if there is a match in the mempool
			for (let i = this.mempool.length - 1; i > 0; i--)
				if (tx.hash("hex") === this.mempool[i].hash("hex"))
					tx_index_to_remove.push(i)
		}

		for (let index of tx_index_to_remove)
			this.mempool.splice(index, 1)

		if (this.internal_peer.bestHeight < block_height)
			this.internal_peer.bestHeight = block_height

		this.blockMap[rblock_hash] = block_message.block
		this.blockHeightMap[rblock_hash] = block_height
		this.lastBlockHash = block_hash
		this.lastRBlockHash = rblock_hash

		// Remove block from requested_blocks
		let requested_index = this.requested_blocks.indexOf(block_hash)
		if (requested_index !== -1)
			this.requested_blocks.splice(requested_index, 1)

		if (!this.initialSyncComplete){
			if (block_height % 500 === 0)
				this.log.debug(`<Peer Block Recieved lastHash={${this.lastBlockHash}} ${this.getInfoString()} />`)

			if (this.lastBlockHash === this.lastHeaderHash){
				this.log.info(`<Peer Block Sync Complete! lastHash={${this.lastBlockHash}} ${this.getInfoString()} />`)
				this.initialSyncComplete = true
			}

			if (this.requested_blocks.length === 0){
				this.requestBlocks()
			}
		} else {
			this.log.debug(`<Peer Block Recieved! lastHash={${this.lastBlockHash}} ${this.getInfoString()} />`)
		}
	}
	requestHeaders(){
		try { this.internal_peer.sendGetHeaders([this.lastHeaderHash]) } catch (e) {}
	}
	requestAddresses(){
		try { this.internal_peer.sendGetAddr() } catch (e) {}
	}
	requestBlocks(){
		try { this.internal_peer.sendGetBlocks([this.lastBlockHash]) } catch (e) { }
	}
	isOpen(){
		return this.open
	}
	getHash(){
		return sha256(Buffer.from(this.options.ip)).toString('hex')
	}
	getIP(){
		return this.options.ip
	}
	getInfoString(){
		return `version={${this.internal_peer.version}} height={${this.internal_peer.bestHeight}} agent={${this.internal_peer.agent}} ip={${this.internal_peer.hostname()}}`
	}
}

export default Peer
