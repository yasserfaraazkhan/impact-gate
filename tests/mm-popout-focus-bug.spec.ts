/**
 * Bug verification test for PR #35990 (MM-68048)
 * Tests: Popout focus tracking for notification suppression
 *
 * Bug #1: Closing a popout window doesn't clear focusedPopout state,
 *         permanently suppressing notifications for that channel.
 *
 * Bug #2: Multiple popouts overwrite each other's focus — blurring one
 *         clears tracking for the other.
 *
 * Target: https://mattermost-pr-35990-fe3yc.test.mattermost.cloud/
 */

import {test, expect, type Page, type BrowserContext} from '@playwright/test';

const BASE_URL = 'https://mattermost-pr-35990-fe3yc.test.mattermost.cloud';

const ADMIN = {
    username: process.env.MM_ADMIN_USERNAME ?? 'sysadmin',
    password: process.env.MM_ADMIN_PASSWORD ?? '',
};
const USER1 = {
    username: process.env.MM_USER1_USERNAME ?? 'user-1',
    password: process.env.MM_USER1_PASSWORD ?? '',
};

/**
 * Login via UI, set landing page seen, return authenticated context + page.
 */
async function loginAs(
    browser: BrowserContext['browser'],
    user: {username: string; password: string},
): Promise<{context: BrowserContext; page: Page}> {
    const context = await browser!.newContext({ignoreHTTPSErrors: true});
    const page = await context.newPage();

    // Step 1: Navigate — lands on /landing#/
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Step 2: Click "View in Browser" (a.btn.btn-tertiary.btn-lg)
    const viewInBrowser = page.locator('a.btn.btn-tertiary.btn-lg');
    await viewInBrowser.waitFor({timeout: 10000});
    await viewInBrowser.click();

    // Step 3: Now on /login — fill credentials
    await page.waitForURL('**/login**', {timeout: 10000});
    await page.locator('#input_loginId').waitFor({timeout: 10000});
    await page.locator('#input_loginId').fill(user.username);
    await page.locator('#input_password-input').fill(user.password);
    await page.locator('#saveSetting').click();

    // Step 4: Wait for channels page
    await page.waitForURL('**/channels/**', {timeout: 20000});
    await page.waitForSelector('#post_textbox', {timeout: 15000});

    return {context, page};
}

/**
 * Navigate to a channel and wait for it to load.
 */
async function goToChannel(page: Page, teamName: string, channelName: string) {
    await page.goto(`${BASE_URL}/${teamName}/channels/${channelName}`);
    await page.waitForSelector('#post_textbox', {timeout: 15000});
}

/**
 * Open a channel popout window. Returns the popout Page.
 */
async function openChannelPopout(page: Page): Promise<Page> {
    // Click the popout button in channel header
    const popoutButton = page.locator('.PopoutButton').first();

    const [popoutPage] = await Promise.all([
        page.waitForEvent('popup'),
        popoutButton.click(),
    ]);

    await popoutPage.waitForLoadState('domcontentloaded');
    await popoutPage.waitForSelector('#post_textbox', {timeout: 15000});

    return popoutPage;
}

/**
 * Post a message to a channel via API using the page's auth context.
 */
async function postMessage(page: Page, channelId: string, message: string) {
    // Use page.evaluate to make the API call within the browser context (has cookies)
    const result = await page.evaluate(
        async ({channelId, message}) => {
            const resp = await fetch('/api/v4/posts', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({channel_id: channelId, message}),
            });
            const body = await resp.text();
            return {ok: resp.ok, status: resp.status, body: body.slice(0, 200)};
        },
        {channelId, message},
    );
    console.log(`postMessage result: ${result.status} ${result.body}`);
    expect(result.ok).toBeTruthy();
}

/**
 * Get a channel by name via API (uses browser context for auth).
 */
async function getChannelByName(page: Page, teamName: string, channelName: string) {
    return page.evaluate(
        async ({teamName, channelName, baseUrl}) => {
            const resp = await fetch(`${baseUrl}/api/v4/teams/name/${teamName}/channels/name/${channelName}`);
            return resp.json();
        },
        {teamName, channelName, baseUrl: BASE_URL},
    );
}

/**
 * Get the team the user belongs to (uses browser context for auth).
 */
async function getTeam(page: Page) {
    return page.evaluate(async ({baseUrl}) => {
        const meResp = await fetch(`${baseUrl}/api/v4/users/me`);
        const me = await meResp.json();
        const teamsResp = await fetch(`${baseUrl}/api/v4/users/${me.id}/teams`);
        const teams = await teamsResp.json();
        return teams[0];
    }, {baseUrl: BASE_URL});
}

// ─── Bug #1: Closing popout doesn't clear focus state ───

test.describe('Bug #1: Popout close leaves stale focus state', () => {
    test(
        'Closing a channel popout should not permanently suppress notifications',
        async ({browser}) => {
            // Setup: Login as admin (notification receiver) and user-1 (message sender)
            const admin = await loginAs(browser, ADMIN);
            const user = await loginAs(browser, USER1);

            const team = await getTeam(admin.page);
            const townSquare = await getChannelByName(admin.page, team.name, 'town-square');

            // Step 1: Admin navigates to town-square
            await goToChannel(admin.page, team.name, 'town-square');

            // Step 2: Stub notifications in admin's browser
            await admin.page.evaluate(() => {
                window._notifications = [];
                const OrigNotification = window.Notification;
                // @ts-ignore
                window.Notification = class MockNotification {
                    constructor(title: string, options?: NotificationOptions) {
                        (window as any)._notifications.push({title, ...options});
                    }
                    static get permission() {
                        return 'granted';
                    }
                    static requestPermission() {
                        return Promise.resolve('granted' as NotificationPermission);
                    }
                    close() {}
                };
                // Preserve static properties
                Object.defineProperty(window.Notification, 'permission', {value: 'granted'});
            });

            // Step 3: Open town-square in a popout window
            let popoutPage: Page;
            try {
                popoutPage = await openChannelPopout(admin.page);
            } catch {
                // If popout button isn't available, try navigating directly
                const [popup] = await Promise.all([
                    admin.page.waitForEvent('popup'),
                    admin.page.evaluate(
                        ({url, teamName}) => {
                            window.open(`${url}/_popout/channel/${teamName}/channels/town-square`);
                        },
                        {url: BASE_URL, teamName: team.name},
                    ),
                ]);
                popoutPage = popup;
                await popoutPage.waitForLoadState('domcontentloaded');
            }

            // Step 4: Focus the popout (click on it)
            await popoutPage.bringToFront();
            await popoutPage.waitForTimeout(1000);

            // Step 5: Close the popout window
            await popoutPage.close();
            await admin.page.waitForTimeout(1000);

            // Step 6: Navigate admin to a DIFFERENT channel (off-topic)
            await goToChannel(admin.page, team.name, 'off-topic');

            // Step 7: User-1 sends a message in town-square (via UI)
            await goToChannel(user.page, team.name, 'town-square');
            const testMessage = `Bug test ${Date.now()}`;
            await user.page.locator('#post_textbox').fill(testMessage);
            await user.page.locator('#post_textbox').press('Enter');
            await user.page.waitForTimeout(1000);

            // Step 8: Wait for notification to arrive
            await admin.page.waitForTimeout(3000);

            // Step 9: Check if notification was received
            const notifications = await admin.page.evaluate(() => (window as any)._notifications || []);

            // BUG: If focusedPopout is stale, notifications will be suppressed
            // EXPECTED: notification should fire (popout is closed, admin is on different channel)
            console.log(`Notifications received: ${notifications.length}`);
            console.log('Notifications:', JSON.stringify(notifications, null, 2));

            if (notifications.length === 0) {
                console.error(
                    'BUG CONFIRMED: No notification received after closing popout. ' +
                    'focusedPopout state is stale — notifications permanently suppressed.',
                );
            }

            // This assertion will FAIL if the bug exists
            expect(
                notifications.length,
                'Expected a notification for town-square message after popout was closed',
            ).toBeGreaterThan(0);

            // Cleanup
            await admin.context.close();
            await user.context.close();
        },
    );
});

// ─── Bug #2: Multiple popouts overwrite focus ───

test.describe('Bug #2: Multiple popouts overwrite focus state', () => {
    test(
        'Blurring one popout should not clear focus tracking for another open popout',
        async ({browser}) => {
            const admin = await loginAs(browser, ADMIN);
            const user = await loginAs(browser, USER1);

            const team = await getTeam(admin.page);
            const townSquare = await getChannelByName(admin.page, team.name, 'town-square');
            const offTopic = await getChannelByName(admin.page, team.name, 'off-topic');

            // Step 1: Admin navigates to town-square
            await goToChannel(admin.page, team.name, 'town-square');

            // Step 2: Stub notifications
            await admin.page.evaluate(() => {
                (window as any)._notifications = [];
                Object.defineProperty(window, 'Notification', {
                    value: class {
                        constructor(title: string, options?: NotificationOptions) {
                            (window as any)._notifications.push({title, ...options});
                        }
                        static permission = 'granted';
                        static requestPermission = () => Promise.resolve('granted');
                        close() {}
                    },
                    writable: true,
                });
            });

            // Step 3: Open popout for town-square (popout A)
            const [popoutA] = await Promise.all([
                admin.page.waitForEvent('popup'),
                admin.page.evaluate(
                    ({url, teamName}) => {
                        window.open(`${url}/_popout/channel/${teamName}/channels/town-square`);
                    },
                    {url: BASE_URL, teamName: team.name},
                ),
            ]);
            await popoutA.waitForLoadState('domcontentloaded');

            // Step 4: Open popout for off-topic (popout B)
            const [popoutB] = await Promise.all([
                admin.page.waitForEvent('popup'),
                admin.page.evaluate(
                    ({url, teamName}) => {
                        window.open(`${url}/_popout/channel/${teamName}/channels/off-topic`);
                    },
                    {url: BASE_URL, teamName: team.name},
                ),
            ]);
            await popoutB.waitForLoadState('domcontentloaded');

            // Step 5: Focus popout A (town-square)
            await popoutA.bringToFront();
            await popoutA.waitForTimeout(500);

            // Step 6: Focus popout B (off-topic) — overwrites focusedPopout
            await popoutB.bringToFront();
            await popoutB.waitForTimeout(500);

            // Step 7: Focus main window — sends BLURRED from popout B
            await admin.page.bringToFront();
            await admin.page.waitForTimeout(500);

            // At this point:
            // - Popout A (town-square) is still OPEN and visible
            // - focusedPopout should track that town-square is visible
            // - BUG: focusedPopout is null because popout B's blur cleared it

            // Step 8: Navigate admin to a third channel
            await goToChannel(admin.page, team.name, 'town-square');
            await admin.page.waitForTimeout(500);

            // Step 9: User sends message in town-square via UI
            await goToChannel(user.page, team.name, 'town-square');
            const testMessage = `Multi-popout test ${Date.now()}`;
            await user.page.locator('#post_textbox').fill(testMessage);
            await user.page.locator('#post_textbox').press('Enter');
            await admin.page.waitForTimeout(3000);

            // Step 10: Check notifications
            const notifications = await admin.page.evaluate(() => (window as any)._notifications || []);

            console.log(`Notifications for multi-popout test: ${notifications.length}`);

            // Note: This test validates the multi-popout scenario.
            // With Bug #2, a notification WILL fire even though town-square
            // is visible in popout A — because focusedPopout was cleared by popout B's blur.
            // The "correct" behavior depends on whether Mattermost intends to support
            // multi-popout tracking (currently it doesn't — single global variable).

            // Bug #2: notification fires for a channel that's still visible in popout A
            // because focusedPopout was cleared when popout B blurred.
            // Expected: no notification when the channel is visible in any popout.
            expect(
                notifications.length,
                'Bug #2: notification fired for town-square even though popout A is still open',
            ).toBe(0);

            // Cleanup
            await popoutA.close();
            await popoutB.close();
            await admin.context.close();
            await user.context.close();
        },
    );
});
