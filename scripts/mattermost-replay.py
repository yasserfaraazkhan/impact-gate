#!/usr/bin/env python3
"""Frozen thirty-PR replay. Stdlib only; no network or CI execution."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def compact_ci(row):
    """Projection shared by fixture creation and immutable-source validation."""
    result = {k: row[k] for k in ('sha_scope', 'fips', 'notes')}
    result['runs'] = []
    for run in row['runs']:
        entry = {k: run[k] for k in ('github', 'all_job_identities_valid', 'fips_jobs')}
        entry['suites'] = []
        for suite in run['suites']:
            s = {k: suite[k] for k in ('suite', 'identity_valid', 'orchestration_complete', 'all_orchestration_workers_valid', 'unknown_or_mismatched_worker_ids', 'counts', 'dispatch_retry_survivor_specs', 'internal_retry_survivor_specs', 'full_report_evidence_available', 'source_files')}
            c = suite['consolidated']
            s['consolidated'] = {k: c[k] for k in ('latest_commit_sha', 'latest_run_attempt', 'contributing_group_identities_valid', 'artifact_failure_reconciliation')}
            s['consolidated']['groups'] = [{k: g[k] for k in ('id', 'identity_and_workers_valid', 'status', 'reports_expected', 'reports_received', 'reports_complete', 'all_expected_reports_complete')} for g in c['groups']]
            s['terminal_failed_specs'] = []
            for failure in suite['terminal_failed_specs']:
                f = {k: v for k, v in failure.items() if k != 'test_cases'}
                f['test_cases'] = [{k: v for k, v in t.items() if k not in ('attachments', 'error_message')} for t in failure['test_cases']]
                s['terminal_failed_specs'].append(f)
            entry['suites'].append(s)
        result['runs'].append(entry)
    return result


def normalized(paths, source, inventory, base_files):
    """Frozen W2/W3 extraction: exact E2E specs present at the merge-base only."""
    accepted, excluded = set(), []
    for original in paths:
        p = original.replace('\\', '/')
        for root in (source, inventory):
            prefix = str(root) + '/'
            if p.startswith(prefix):
                p = p[len(prefix):]
                break
        if p.startswith('specs/'):
            p = 'e2e-tests/playwright/' + p
        elif p.startswith('../cypress/'):
            p = 'e2e-tests/cypress/' + p[len('../cypress/'):]
        elif p.startswith('tests/integration/'):
            p = 'e2e-tests/cypress/' + p
        is_e2e = bool(re.fullmatch(r'e2e-tests/playwright/specs/.+\.spec\.[tj]sx?', p) or re.fullmatch(r'e2e-tests/cypress/tests/integration/.+(?:_spec|\.spec|\.cy)\.[tj]sx?', p))
        if is_e2e and p in base_files:
            accepted.add(p)
        else:
            excluded.append({'path': original, 'normalized': p, 'reason': 'not an exact preexisting E2E spec'})
    return sorted(accepted), excluded


def suite_observations(pr, evidence, base_files, named, effective):
    observations, failures = [], []
    head = pr['headRefOid']
    for run in pr['ci']['runs']:
        gh = run['github']
        for suite in run['suites']:
            c = suite['consolidated']
            groups = c['groups']
            identity = (gh['head_sha'] == head and gh['sha_kind'] == 'pr_head' and run['all_job_identities_valid'] and suite['identity_valid'] and suite['all_orchestration_workers_valid'] and not suite['unknown_or_mismatched_worker_ids'] and c['latest_commit_sha'] == head and str(c['latest_run_attempt']) == str(gh['run_attempt']) and c['contributing_group_identities_valid'])
            complete = bool(identity and suite['orchestration_complete'] and suite['full_report_evidence_available'] and groups and all(g['identity_and_workers_valid'] and g['status'] == 'completed' and g['all_expected_reports_complete'] and g['reports_expected'] == g['reports_received'] == g['reports_complete'] for g in groups))
            obs = {'suite': suite['suite'], 'run': gh['id'], 'attempt': gh['run_attempt'], 'identityValid': bool(identity), 'complete': complete, 'workerReports': groups, 'counts': suite['counts'], 'unknown': not complete, 'dispatchRetrySurvivors': suite['dispatch_retry_survivor_specs'], 'internalRetrySurvivors': suite['internal_retry_survivor_specs']}
            observations.append(obs)
            for f in suite['terminal_failed_specs']:
                path = f['repo_spec_path']
                exact = f['head_sha'] == head and str(f['run_id']) == str(gh['id']) and str(f['run_attempt']) == str(gh['run_attempt']) and f['suite'] == suite['suite']
                raw_path = next(p for p in suite['source_files'] if p.endswith('.orchestration.json'))
                raw = json.loads((evidence / 'ci' / raw_path).read_text())
                require(raw['commit_sha'] == head and str(raw['gh_run_id']) == str(gh['id']) and str(raw['gh_run_attempt']) == str(gh['run_attempt']) and raw['name'] == suite['suite'] and raw['gh_pr_number'] == pr['number'], 'raw failure suite identity mismatch')
                units = [u for u in raw['units'] if u['spec_path'] == f['spec_path']]
                require(len(units) == 1, 'terminal failure unit missing or ambiguous')
                attempts = [a for a in units[0]['attempts'] if not a['expired'] and not a['late_report'] and a['reported_at']]
                final = max(attempts, key=lambda a: a['reported_at'])
                require(units[0]['state'] == 'completed_fail' and final['status'] == f['final_attempt_status'] == 'failed' and final['id'] == f['final_attempt_id'] and str(final['gh_job_id']) == str(f['final_worker_job_id']), 'terminal failure provenance mismatch')
                confirmed = any(r['classification'] == 'terminal_failure_confirmed' and any(m['repo_spec_path'] == path and str(m['worker_job_id']) == str(f['final_worker_job_id']) and m['terminal_test_status'] == 'failed' for m in r.get('terminal_matches', [])) for r in c['artifact_failure_reconciliation'])
                eligible = bool(exact and complete and confirmed and path in base_files)
                failures.append({**f, 'pr': pr['number'], 'preexisting': path in base_files, 'eligible': eligible, 'namedIncluded': path in named if eligible else None, 'effectiveIncluded': path in effective if eligible else None, 'sourceFiles': suite['source_files']})
    return observations, failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', required=True, type=Path)
    parser.add_argument('--source-cache', required=True, type=Path)
    parser.add_argument('--evidence-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--fixture', type=Path, default=Path(__file__).with_name('mattermost-replay-fixture.json'))
    parser.add_argument('--timeout', type=int, default=600)
    args = parser.parse_args()
    cli, cache, evidence, output = [p.resolve() for p in (args.cli, args.source_cache, args.evidence_root, args.output)]
    require(args.timeout > 0, 'timeout must be positive')
    require(not output.exists(), 'use a new output directory; receipts are never overwritten')
    require(not output.is_relative_to(cache) and not output.is_relative_to(evidence), 'output must be outside immutable inputs')
    fixture = json.loads(args.fixture.read_text())
    prs = fixture['prs']
    require(len(prs) == 30 and len({p['number'] for p in prs}) == 30, 'fixture must contain exactly thirty unique PRs')
    for file, sha in fixture['sourceSha256'].items():
        require(digest(evidence / file) == sha, f'immutable input hash mismatch: {file}')
    original_prs = json.loads((evidence / 'prs.json').read_text())
    index = json.loads((evidence / 'ci/validated-index.json').read_text())
    require([{k: v for k, v in p.items() if k != 'ci'} for p in prs] == original_prs, 'sample differs from frozen input')
    for p, row in zip(prs, index['prs']):
        require(row['pr']['number'] == p['number'] and p['ci'] == compact_ci(row), 'CI fixture differs from immutable index')
    output.mkdir(parents=True)
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'HOME': str(output / 'home'), 'CI': '1', 'NO_COLOR': '1'}
    Path(env['HOME']).mkdir()
    node = shutil.which('node', path=env['PATH'])
    require(node is not None and cli.is_file(), 'built CLI and node are required')

    def run(argv, directory, name, cwd=output, allowed=(0,)):
        directory.mkdir(parents=True, exist_ok=True)
        start = time.monotonic()
        try:
            p = subprocess.run([str(x) for x in argv], cwd=cwd, env=env, capture_output=True, text=True, timeout=args.timeout)
            code, out, err = p.returncode, p.stdout, p.stderr
        except subprocess.TimeoutExpired as exc:
            code, out, err = 124, exc.stdout or '', exc.stderr or ''
            if isinstance(out, bytes): out = out.decode(errors='replace')
            if isinstance(err, bytes): err = err.decode(errors='replace')
            err += f'\nReplay timeout after {args.timeout}s\n'
        (directory / f'{name}.stdout.txt').write_text(out)
        (directory / f'{name}.stderr.txt').write_text(err)
        write_json(directory / f'{name}.command.json', {'argv': [str(x) for x in argv], 'command': shlex.join([str(x) for x in argv]), 'cwd': str(cwd), 'environment': env, 'exitCode': code, 'seconds': round(time.monotonic()-start, 3)})
        require(code in allowed, f'{name}: exit {code}; see preserved receipt')
        return out

    project = cli.parent.parent
    fingerprints = {'cli': str(cli), 'cliSha256': digest(cli), 'fixtureSha256': digest(args.fixture), 'harnessSha256': digest(__file__), 'argv': sys.argv, 'cwd': str(Path.cwd()), 'environment': env, 'sourceFiles': {}, 'buildFiles': {}}
    for directory, key in ((project / 'src', 'sourceFiles'), (cli.parent, 'buildFiles')):
        require(directory.is_dir(), f'missing fingerprint directory: {directory}')
        fingerprints[key] = {str(f.relative_to(project)): digest(f) for f in sorted(directory.rglob('*')) if f.is_file()}
    fingerprints['sourceRevision'] = run(['git', '-C', project, 'rev-parse', 'HEAD'], output, 'cli-revision').strip()
    run(['git', '-C', project, 'diff', '--', 'src'], output, 'cli-source-diff')
    fingerprints['nodeVersion'] = run([node, '--version'], output, 'node-version').strip()
    write_json(output / 'provenance.json', fingerprints)
    write_json(output / 'replay.config.json', {'git': {'includeUncommitted': False}})
    source, inventory = output / 'source', output / 'base-inventory'
    for target in (source, inventory):
        run(['git', 'clone', '--shared', '--no-checkout', cache, target], output, f'clone-{target.name}')
    rows = []
    for pr in prs:
        d = output / str(pr['number'])
        row = {'number': pr['number'], 'title': pr['title'], 'url': pr['url'], 'head': pr['headRefOid'], 'baseRefOid': pr['baseRefOid']}
        try:
            bases = run(['git', '-C', source, 'merge-base', '--all', pr['baseRefOid'], pr['headRefOid']], d, 'merge-base').splitlines()
            require(len(bases) == 1, 'merge-base unavailable or ambiguous')
            base = row['base'] = bases[0]
            for target, sha in ((source, row['head']), (inventory, base)):
                run(['git', '-C', target, 'checkout', '--detach', sha], d, f'checkout-{target.name}')
            row['changedFiles'] = run(['git', '-C', source, 'diff', '--name-only', '--no-renames', base, row['head']], d, 'changed-files').splitlines()
            base_files = set(run(['git', '-C', inventory, 'ls-tree', '-r', '--name-only', base], d, 'base-files').splitlines())
            full_inventory, _ = normalized(base_files, source, inventory, base_files)
            common = ['--config', output / 'replay.config.json', '--path', source, '--since', base, '--tests-root', inventory / 'e2e-tests/playwright', '--json']
            review = json.loads(run([node, cli, 'review', *common, '--ci-comment-path', d / 'review.md'], d, 'review'))
            plan = json.loads(run([node, cli, 'plan', *common, '--no-ai'], d, 'plan'))
            require(isinstance(review, dict) and 'metrics' in review and isinstance(plan, dict) and plan.get('runSet') in ('full', 'targeted', 'smoke'), 'invalid review/plan object')
            write_json(d / 'review.json', review); write_json(d / 'plan.json', plan)
            paths = [p for f in review['impactedFlows'] for p in f['existingTests']]
            paths += [t['file'] for t in review.get('relevantExistingTests', [])]
            paths += [r['alreadyCoveredBy'] for r in review.get('recommendations', []) if r.get('alreadyCoveredBy')]
            named, excluded = normalized(paths, source, inventory, base_files)
            effective = full_inventory if plan['runSet'] == 'full' else normalized(plan['recommendedTests'], source, inventory, base_files)[0]
            observations, failures = suite_observations(pr, evidence, base_files, named, effective)
            row.update({'completed': True, 'namedExistingE2E': named, 'excludedNamedPaths': excluded, 'namedExistingE2ECount': len(named), 'effectiveRunSet': plan['runSet'], 'effectiveSelectedE2E': effective, 'baseE2ECount': len(full_inventory), 'effectiveSelectedE2ECount': len(effective), 'prIncludedTests': review.get('prIncludedTestSummary'), 'decision': review['decision'], 'ciObservations': observations, 'ciUnknown': not observations or any(o['unknown'] for o in observations), 'failures': failures})
        except (ValueError, OSError) as exc:
            row.update({'completed': False, 'error': str(exc)})
        rows.append(row)
        write_json(output / 'rows.json', rows)
        print(json.dumps({k: row.get(k) for k in ('number', 'completed', 'namedExistingE2ECount', 'effectiveRunSet', 'error')}), flush=True)
    complete = len(rows) == 30 and all(r['completed'] for r in rows)
    failures = [f for r in rows if r['completed'] for f in r['failures'] if f['eligible']]
    named_missed = sum(not f['namedIncluded'] for f in failures)
    effective_missed = sum(not f['effectiveIncluded'] for f in failures)
    total_inventory = sum(r.get('baseE2ECount', 0) for r in rows)
    selected = sum(r.get('effectiveSelectedE2ECount', 0) for r in rows)
    summary = {'completed': complete, 'rowsCompleted': sum(r['completed'] for r in rows), 'sampleSize': 30, 'namedOmission': {'numerator': named_missed, 'denominator': len(failures), 'fraction': named_missed/len(failures) if failures else None}, 'effectiveOmission': {'numerator': effective_missed, 'denominator': len(failures), 'fraction': effective_missed/len(failures) if failures else None}, 'fullSuiteRows': sum(r.get('effectiveRunSet') == 'full' for r in rows), 'baseSpecOccurrences': total_inventory, 'effectiveSelectedSpecOccurrences': selected, 'staticSelectionReduction': 1-selected/total_inventory if total_inventory else None, 'runtimeSavings': 'not measured; full fallback offers zero selection savings', 'failures': failures, 'ciSuitesObserved': sum(len(r.get('ciObservations', [])) for r in rows), 'ciSuitesComplete': sum(o['complete'] for r in rows for o in r.get('ciObservations', [])), 'headsWithoutObservedSuites': [r['number'] for r in rows if r['completed'] and not r['ciObservations']]}
    write_json(output / 'summary.json', summary)
    lines = ['# Frozen Mattermost replay', '', 'Most recently updated merged PRs targeting master; not random or latest-merge-date sampled. Observed failure omission is not causal regression accuracy. Unknown suites and skipped FIPS are not passes.', '', f'Named omission: {named_missed}/{len(failures)}. Effective omission: {effective_missed}/{len(failures)}. Full-suite rows: {summary["fullSuiteRows"]}/30. Static selection reduction: {summary["staticSelectionReduction"]}.', '', '| PR | Base | Head | Named E2E | Effective set/count | CI worker reports | Eligible failures: named/effective included |', '|---|---|---|---:|---|---|---|']
    for r in rows:
        if not r['completed']:
            lines.append(f'| {r["number"]} | | {r["head"]} | | ERROR | {r["error"]} | unknown |'); continue
        ci = '; '.join(f'{o["suite"]} {o["run"]}/{o["attempt"]}: ' + ','.join(f'{g["reports_complete"]}/{g["reports_expected"]}' for g in o['workerReports']) + (' complete' if o['complete'] else ' unknown/incomplete') for o in r['ciObservations']) or 'unknown: no exact-head E2E run'
        failed = '; '.join(f'{f["repo_spec_path"]}: {f["namedIncluded"]}/{f["effectiveIncluded"]}' for f in r['failures'] if f['eligible']) or '0 eligible observed'
        lines.append(f'| [{r["number"]}]({r["url"]}) | {r["base"]} | {r["head"]} | {r["namedExistingE2ECount"]} | {r["effectiveRunSet"]}/{r["effectiveSelectedE2ECount"]} | {ci} | {failed} |')
    (output / 'REPORT.md').write_text('\n'.join(lines) + '\n')
    require(complete, 'replay incomplete; error rows/receipts retained, no successful baseline claim')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
