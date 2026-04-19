export const DEFAULT_FOILOPS_WALLET_ADDRESS = '4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd'
export const getFoilopsWalletAddress = (): string =>
  process.env.FOILOPS_WALLET_ADDRESS || DEFAULT_FOILOPS_WALLET_ADDRESS
export const MAX_5_MIN_TXS_ALLOWED = 10
export const MAX_TPS_ALLOWED = 2.0
export const MAX_TPS_FOR_BAN = 2.2

export const BOT_USERNAME = 'foilops_bot'

export const WALLET_SLEEP_TIME = 2 * 60 * 60 * 1000

export const ASCII_TEXT = `
╔═══╗────╔╗──╔╗────╔═══╗
║╔═╗║────║║──║║────║╔═╗║
║║─╚╬══╦═╝╠══╣║╔══╦╝╚═╝║
║║─╔╣╔╗║╔╗║╔╗║║║╔╗╠╗╔╗╔╝
║╚═╝║╚╝║╚╝║╚╝║╚╣╚╝║║║╚╗
╚═══╩══╩══╩══╩═╩══╩╝╚═╝
`
