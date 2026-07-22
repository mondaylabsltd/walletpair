import { expect, test, type Page } from '@playwright/test';

async function openPlayground(page: Page) {
	await page.goto('/playground');
	await expect(page.locator('.playground-wrap')).toBeVisible();
}

function dapp(page: Page) {
	return page
		.locator('.session-panel')
		.filter({ has: page.locator('h3', { hasText: 'Create a pairing QR' }) });
}

function wallet(page: Page) {
	return page
		.locator('.session-panel')
		.filter({ has: page.locator('h3', { hasText: 'Verify and join' }) });
}

test.describe('EVM playground', () => {
	test('renders a guided EVM-only flow', async ({ page }) => {
		await openPlayground(page);
		await expect(page.locator('h1')).toHaveText('Playground');
		await expect(page.locator('.steps')).toContainText('Create a QR');
		await expect(page.locator('.protocol-note')).toContainText('Same-page demo');
		await expect(page.locator('.protocol-note')).toContainText('eip155:1');
		await expect(dapp(page).locator('.badge')).toHaveText('EVM');
		await expect(wallet(page).locator('.badge')).toHaveText('EVM');
	});

	test('keeps advanced settings out of the initial path', async ({ page }) => {
		await openPlayground(page);
		await expect(dapp(page).locator('button', { hasText: 'Create pairing QR' })).toBeVisible();
		await expect(dapp(page).locator('input[placeholder="wss://relay.example/v1"]')).toBeHidden();
		await expect(wallet(page).locator('button', { hasText: 'Generate demo wallet' })).toBeVisible();
		await expect(wallet(page).locator('input[placeholder="64 hex characters"]')).toBeHidden();
	});

	test('generates a demo EOA address', async ({ page }) => {
		await openPlayground(page);
		const panel = wallet(page);
		await panel.locator('button', { hasText: 'Generate demo wallet' }).click();
		await expect(panel.locator('.address')).toHaveText(/^0x[0-9a-f]{40}$/);
	});

	test('pairs both roles in the same page and sends a request', async ({ page }) => {
		await openPlayground(page);
		const dappPanel = dapp(page);
		const walletPanel = wallet(page);

		await dappPanel.locator('button', { hasText: 'Create pairing QR' }).click();
		await walletPanel.locator('button', { hasText: 'Generate demo wallet' }).click();
		await walletPanel.locator('button', { hasText: 'Use current pairing' }).click();
		await walletPanel.locator('button', { hasText: 'Verify pairing code' }).click();
		await walletPanel.locator('button', { hasText: 'Code matches — join' }).click();

		await expect(dappPanel.locator('.status')).toHaveText('Paired');
		await expect(walletPanel.locator('.status')).toHaveText('Paired');
		await expect(
			dappPanel.getByText('Paired successfully — send a test request below.')
		).toBeVisible();

		await dappPanel.locator('button', { hasText: 'Send request' }).click();
		await expect(walletPanel.locator('.request')).toContainText('eth_requestAccounts');
		await walletPanel.locator('button', { hasText: 'Approve' }).click();
		await expect(walletPanel.locator('.request')).toHaveCount(0);
		await expect(dappPanel.locator('.request-result')).toContainText('Wallet response');
		await expect(dappPanel.locator('.request-result code')).toHaveText(/^\["0x[0-9a-f]{40}"\]$/);
	});

	test('rejects an invalid pairing URI before connecting', async ({ page }) => {
		await openPlayground(page);
		const panel = wallet(page);
		await panel.locator('button', { hasText: 'Generate demo wallet' }).click();
		await panel
			.locator('input[placeholder="Paste a walletpair: link"]')
			.fill('walletpair:?ch=invalid');
		await panel.locator('button', { hasText: 'Verify pairing code' }).click();
		await panel.locator('details.activity summary').click();
		await expect(panel.locator('.log-entry', { hasText: 'pairing URI' })).toBeVisible();
	});
});
