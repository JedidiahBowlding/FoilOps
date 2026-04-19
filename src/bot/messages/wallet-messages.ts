import { User } from '@prisma/client'
import { UserBalances } from '../../lib/user-balances'

export class WalletMessages {
  private userBalances: UserBalances
  constructor() {
    this.userBalances = new UserBalances()
  }

  static addWalletMessage: string = `
🐱 Ok, just send me a wallet address to track:

Formats:
• Solana: <code>SoLAddress...</code>
• Ethereum: <code>eth:0x...</code>
• BNB: <code>bnb:0x...</code>

Shortcut examples after pressing Add:
• <code>SoLAddress... MySolWallet</code>
• <code>eth:0xabc123... MyEthWallet</code>
• <code>bnb:0xabc123... MyBnbWallet</code>

You can also give that wallet a name by following the address with the desired name, or add multiple wallets at once by sending them each on a new line for example: 

SoLAddress... walletName1
eth:0xabc123... walletName2
`

  static deleteWalletMessage: string = `
Send me the wallet address you want to remove 🗑️

For Ethereum/BNB, include prefix: <code>eth:0x...</code> or <code>bnb:0x...</code>

Shortcut examples after pressing Delete:
• <code>SoLAddress...</code>
• <code>eth:0xabc123...</code>
• <code>bnb:0xabc123...</code>

You can also delete multiple wallets at once if you send them each on a new line, for example:

SoLAddress...
eth:0xabc123...
`

  public async sendMyWalletMessage(
    wallet: Pick<User, 'personalWalletPrivKey' | 'personalWalletPubKey'>,
  ): Promise<string> {
    const solBalance = await this.userBalances.userPersonalSolBalance(wallet.personalWalletPubKey)

    const responseText = `
<b>Your wallet address:</b> 
<code>${wallet && wallet.personalWalletPubKey}</code>

<b>SOL:</b> ${solBalance ? solBalance / 1e9 : 0}

`

    return responseText
  }
}
