/**
 * Alamat terakhir daftar paket (halaman dan filter ada di query string). Detail dan form paket kembali ke sini, bukan ke
 * `/packages` polos, supaya CS/admin tidak terlempar ke halaman 1 setelah membuka atau menyunting paket.
 */
let lastListUrl = '/packages';

export function rememberPackagesList(search: string) {
  lastListUrl = `/packages${search}`;
}

export function packagesListUrl() {
  return lastListUrl;
}
