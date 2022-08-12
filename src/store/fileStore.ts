import { WebBundlr } from "@bundlr-network/client";
import {
  useChainApi,
  useAnchorWallet,
  useAnchorProvider,
} from "../api/chain-api";
import { createGlobalState } from "@vueuse/core";
import { watch, ref } from "vue";
import { Connection, Transaction } from "@solana/web3.js";
import BigNumber from "bignumber.js";
const FORCE_ANCHOR_WALLET = true;
import axios from "axios";

export function spaceString(
  val: number,
  precision = 0,
  prefixes = ["B", "KB", "MB", "GB", "TB"]
) {
  let idx = 0;
  while (val > 1e3 && idx < prefixes.length) {
    val /= 1e3;
    idx += 1;
  }
  let rtn = `${val.toFixed(precision)}`;
  if (idx < prefixes.length) {
    rtn += ` ${prefixes[idx]}`;
  }
  return rtn;
}

function createFileStore() {
  let { wallet, connection, provider } = useChainApi();
  if (FORCE_ANCHOR_WALLET) {
    // Force real wallet
    wallet = useAnchorWallet();
    connection = new Connection(
      "https://api.mainnet-beta.solana.com",
      "processed"
    );
    provider = useAnchorProvider(connection, wallet);
  }

  let bundlr: WebBundlr | null = null;
  let readyPromise: Promise<void> | null = null;
  const mbCostArweave = ref(new BigNumber(0));
  const mbCostSolana = ref(new BigNumber(0));

  watch(
    [wallet],
    async () => {
      if (wallet.value) {
        const pvd = {
          publicKey: wallet.value.publicKey,
          sendTransaction: async (tx: Transaction) => {
            await provider.value?.sendAndConfirm(tx);
          },
          signMessage: async (msg: Uint8Array) => {
            return wallet.value?.signMessage(msg);
          },
        };
        bundlr = new WebBundlr("https://node1.bundlr.network", "solana", pvd);
        readyPromise = bundlr.ready();
        // Ready up
        await readyPromise;
        // Load costs
        mbCostArweave.value = await getCost(1e6);
        const rent = await connection.getMinimumBalanceForRentExemption(1e6);
        mbCostSolana.value = new BigNumber(rent);
      }
    },
    { immediate: true }
  );

  async function awaitBundlr() {
    if (!readyPromise || !bundlr) {
      throw new Error("Wallet not ready");
    }
    await readyPromise;
  }

  async function getBalance() {
    await awaitBundlr();
    return await bundlr!.getLoadedBalance();
  }

  async function getCost(bytes: number) {
    await awaitBundlr();
    return await bundlr!.getPrice(bytes);
  }

  async function deposit(amount: BigNumber) {
    await awaitBundlr();
    if (!bundlr) return;
    const fundStatus = await bundlr.fund(amount);
    return fundStatus;
  }

  async function withdrawBalance() {
    await awaitBundlr();
    if (!bundlr) return;
    const balance = await getBalance();
    await bundlr.withdrawBalance(balance!);
  }

  async function uploadFile(data: ArrayBuffer) {
    await awaitBundlr();
    if (!bundlr) return;
    // Get balance
    const balance = await getBalance();
    const cost = await getCost(data.byteLength);
    if (balance.isLessThan(cost)) throw new Error("Insufficient funds");

    // Upload file
    // application/octet-stream
    const tags = [{ name: "Content-Type", value: "application/octet-stream" }];
    const tx = bundlr.createTransaction(new Uint8Array(data), { tags });
    // Sign and send transaction
    await tx.sign();
    const result = await tx.upload();
    if (!result.data || !result.data.id) throw new Error("File upload failed");
    return result.data.id;
  }

  async function downloadFile(id: string) {
    const url = `https://arweave.net/${id}`;
    const resp = await axios.get(url, { responseType: "blob" });
    if (resp.data instanceof Blob) return resp.data.arrayBuffer();
    else throw new Error("Invalid file id");
  }

  return {
    getBalance,
    getCost,
    deposit,
    withdrawBalance,
    uploadFile,
    downloadFile,
    mbCostArweave,
    mbCostSolana,
  };
}

export const useFileStore = createGlobalState(() => createFileStore());
