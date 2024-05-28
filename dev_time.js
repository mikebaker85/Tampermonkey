// ==UserScript==
// @name         Dev time
// @namespace    http://tampermonkey.net/
// @version      2024-05-28
// @description  Display the dev time on Shortcut
// @author       Mike Baker
// @require      https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.30.1/moment.min.js
// @match        https://app.shortcut.com/madcapsule/stories/space/34262*
// @grant        GM.xmlHttpRequest
// @connect      api.app.shortcut.com
// @connect      www.gov.uk
// ==/UserScript==

(function() {
    'use strict';

    const ShortcutApiToken = '664f0b51-6aa9-4beb-b5da-3963c3ff1f5d';
    const cardSelector = 'div[role=gridcell] div[data-public-id]';
    let bankHolidays = [];

    const css = `
        .tm-css-14k4spz {
            max-width: 100%;
            overflow: hidden;
        }

        .tm-css-1kjcm14 {
            font-size: 0.75rem;
            line-height: 1.2;
            border-radius: 6px;
            padding: 3px 6px;
            gap: 4px;
            display: inline-flex;
            -webkit-box-align: center;
            align-items: center;
            -webkit-box-pack: center;
            justify-content: center;
            min-height: 20px;
            overflow: hidden;
            max-width: 100%;
            box-sizing: border-box;
            word-break: break-all;
            height: 100%;
            flex: 0 0 auto;
        }

        .tm-css-1f2zx17 {
            display: flex;
            -webkit-box-pack: center;
            justify-content: center;
            -webkit-box-align: center;
            align-items: center;
            transform: scale(0.9);
        }

        .tm-css-na4t19 {
            color: currentcolor;
            flex-shrink: 0;
        }

        .tm-css-1gqv2en {
            width: 20px;
            height: 20px;
        }

         .overdue-card, .overdue-card-dated {
            outline: 1px solid rgba(204, 55, 75, 0.6);
            outline-offset: -1px;
        }

        .overdue-card-dated .warning path {
            fill: rgb(255, 255, 255);
        }

        .overdue-card .warning path {
            fill: rgb(204, 55, 75);
        }

        .overdue-card-dated .tm-css-1kjcm14 {
            color: rgb(255, 255, 255);
            background-color: rgb(204, 55, 75);
        }
    `;

    const overdueTagHtml = `
        <span class="tm-css-14k4spz">
            <span class="tm-css-1kjcm14">
                <span class="tm-css-1f2zx17">
                    <div class="tm-css-na4t19">
                        <span class="tm-css-1f2zx17">
                            <div aria-hidden="true" focusable="false" class="tm-css-1gqv2en">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="warning">
                                    <path fill="#fff" d="M256 32c14.2 0 27.3 7.5 34.5 19.8l216 368c7.3 12.4 7.3 27.7 .2 40.1S486.3 480 472 480H40c-14.3 0-27.6-7.7-34.7-20.1s-7-27.8 .2-40.1l216-368C228.7 39.5 241.8 32 256 32zm0 128c-13.3 0-24 10.7-24 24V296c0 13.3 10.7 24 24 24s24-10.7 24-24V184c0-13.3-10.7-24-24-24zm32 224a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z"/></svg>
                                </svg>
                            </div>
                            <span style="position: absolute; border: 0px; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; overflow-wrap: normal;">
                                Overdue deadline
                            </span>
                        </span>
                    </div>
                </span>
                Overdue: %%
            </span>
        </span>`;

    function onElementAvailable(selector, callback) {
        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                callback();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    onElementAvailable(cardSelector, async () => {
        await loadBankHolidays();
        processCards();
    });

    /**
     * Get bank holiday dates
     */
    async function loadBankHolidays() {
        const res = await GM.xmlHttpRequest({
            method: 'GET',
            url: 'https://www.gov.uk/bank-holidays.json',
            headers: { "Accept": "application/json" },
        })
        .catch(e => console.error(e));

        const json = JSON.parse(res.responseText);
        bankHolidays = json['england-and-wales'].events.map(event => event.date);
    }

    /**
     * Scrape the UI for story IDs and process cards
     */
    function processCards() {
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = css;
        document.head.appendChild(style);

        const cards = document.querySelectorAll(cardSelector)
        cards.forEach(card => {
            processCard(card.getAttribute('data-public-id'));
        });
    }

    /**
     * Process a card. Download story data and display data if required
     * @param {number} storyId Shortcut story ID
     */
    async function processCard(storyId) {
        const story = await getStory(storyId);
        if (story.completed) {
            console.log('Completed', storyId, story);
            return;
        } else if (!story.started) {
            console.log('Not Started', storyId, story);
            return;
        }

        const points = story.estimate;
        if (points < 1) {
            console.log('0-points:', storyId, story);
            return;
        }

        const now = Date.now();
        const startDate = Date.parse(story.started_at);
        const workingDays = getWorkingDays(story.started_at);

        if (workingDays <= points) {
            console.log('OK:', storyId, story);
            return;
        }

        if (story.labels.find(label => label.name == 'l')) {
            console.log('Whitelisted:', storyId, story);
            return;
        }

        console.log('Overdue:', storyId, story);
        markCardOverdue(storyId, points, workingDays, story.deadline !== null);
    }

    /**
     * Get story data from Shortcut
     * @param {number} storyId Shortcut story ID
     * @return {object}
     */
    async function getStory(storyId) {
        const res = await GM.xmlHttpRequest({
            method: 'GET',
            url: `https://api.app.shortcut.com/api/v3/stories/${storyId}`,
            headers: {
                "Content-Type": "application/json",
                "Shortcut-Token": ShortcutApiToken,
            },
        })
        .catch(e => console.error(e));

        return JSON.parse(res.responseText);
    }

    /**
     * Calculate and return the working days count between two dates
     * @param {string} fromDate Date to calculate from
     * @param {string|null} (Optional) toDate Date to calculate to or "now" if `null`
     * @return {number}
     */
    function getWorkingDays(fromDate, toDate = null) {
        let count = 0;
        const from = moment(fromDate);
        const to = toDate === null ? moment() : moment(toDate);

        if (from.format('HHmmss') != '000000') {
            if (isWorkingDay(from)) {
                count ++;
            }
            from.startOf('day').add(1, 'days');
        }

        while(from < to) {
            if (isWorkingDay(from)) {
                count ++;
            }
            from.add(1, 'days');
        }

        return count;
    }

    /**
     * Return if a date is a working day (not a weekend or bank holiday)
     * @param {Moment} date Date to check
     * @return {bool}
     */
    function isWorkingDay(date) {
        return ![0, 6].includes(date.day()) && !bankHolidays.includes(date.format('YYYY-MM-DD'));
    }

    /**
     * Apply the overdue UI changes to a card
     * @param {number} storyId Shortcut story ID
     * @param {number} points The story's points score
     * @param {number} workingDays Number of working days spent on the card
     * @param {bool} isDated Does the story have a due date?
     */
    function markCardOverdue(storyId, points, workingDays, isDated) {
        const percent = ((workingDays / points) * 100) - 100;

        const card = document.querySelector(`div[role=gridcell] div[data-public-id='${storyId}']`);
        card.classList.add(isDated ? 'overdue-card-dated' : 'overdue-card');
        const description = card.firstChild.firstChild;
        const tagsHolder = description.nextSibling;

        const parser = new DOMParser();
        const html = overdueTagHtml.replace('%%', `${percent}%`);
        const newTag = parser.parseFromString(html, 'text/html');
        tagsHolder.appendChild(newTag.body.firstChild);
    }
})();
