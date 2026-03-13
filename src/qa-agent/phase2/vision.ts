// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {readFileSync} from 'fs';

import {LLMProviderFactory} from '../../provider_factory.js';
import type {Finding, FindingSeverity, FindingType} from '../types.js';

const VALID_TYPES = new Set<FindingType>(['bug', 'visual-regression', 'ux-issue', 'gap']);
const VALID_SEVERITIES = new Set<FindingSeverity>(['critical', 'high', 'medium', 'low', 'info']);

const VISION_PROMPT = `You are a QA engineer analyzing a screenshot of a web application.
Look for these categories of issues:

1. **Layout issues**: overlapping elements, misaligned content, broken grid, elements outside viewport
2. **Visual issues**: truncated text, missing icons/images, broken styling, inconsistent spacing
3. **UX issues**: unclear button labels, confusing navigation, missing feedback states, poor contrast
4. **State issues**: loading spinners stuck, empty states without messaging, stale data indicators
5. **Error states**: visible error messages, 404/500 pages, broken components

For each issue found, respond with a JSON array of objects:
[
  {
    "type": "bug" | "visual-regression" | "ux-issue",
    "severity": "critical" | "high" | "medium" | "low" | "info",
    "summary": "description of the issue"
  }
]

If no issues are found, respond with an empty array: []

Only report clear, actionable issues. Do not speculate about functionality you cannot see.`;

export async function analyzeScreenshot(
    screenshotPath: string,
    url: string,
    flow: string,
): Promise<Finding[]> {
    const provider = await LLMProviderFactory.createFromEnv();

    if (!provider.capabilities.vision || !provider.analyzeImage) {
        return [];
    }

    let imageData: string;
    try {
        imageData = readFileSync(screenshotPath).toString('base64');
    } catch {
        return [];
    }
    const response = await provider.analyzeImage(
        [{base64: imageData, mediaType: 'image/png'}],
        VISION_PROMPT,
        {maxTokens: 2000, temperature: 0.1},
    );

    return parseVisionResponse(response.text, url, flow, screenshotPath);
}

function parseVisionResponse(text: string, url: string, flow: string, screenshotPath: string): Finding[] {
    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
        const items = JSON.parse(jsonMatch[0]) as Array<{
            type: string;
            severity: string;
            summary: string;
        }>;

        if (!Array.isArray(items)) return [];

        return items
            .filter((item) => {
                const t = String(item.type || '');
                const s = String(item.severity || '');
                return VALID_TYPES.has(t as FindingType) && VALID_SEVERITIES.has(s as FindingSeverity);
            })
            .map((item) => ({
                id: `v-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
                type: String(item.type) as FindingType,
                severity: String(item.severity) as FindingSeverity,
                summary: String(item.summary || 'Visual issue detected'),
                flow,
                evidence: {
                    url,
                    screenshotPath,
                    reproSteps: ['Captured via automated vision analysis'],
                },
                timestamp: Date.now(),
            }));
    } catch {
        return [];
    }
}
