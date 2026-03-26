# Evidence Case Lab Report

## REVIEW NEEDED: 9 Verdicts May Be Wrong

The system said **SATISFIED** for these questions, but the grounding evidence suggests the verdict may be incorrect. **You decide.**

### Grounding Warnings (4)

These are SATISFIED verdicts where ID-like terms from the question did not resolve against the corpus. The system found real QRAs by keyword similarity, but the specific entities the question claims may not exist.

| # | ID | Question | Unresolved Terms | Grounding Ratio |
|---|-----|----------|------------------|-----------------|
| 1 | R06 | Which SPARTA threats are most relevant to the F-36's navigat | **ARP4761** | 95% |
| 2 | R08 | How do the F-36's HIL test procedures validate SPARTA counte | **ARP4761** | 95% |
| 3 | R15 | Considering the F-36's use of ARP4761 for safety assessment, | **ARP4761** | 96% |
| 4 | R40 | Given the F-36's use of sensor fusion in its flight control  | **ARP4761** | 96% |

#### [R06] Which SPARTA threats are most relevant to the F-36's navigation system's GPS rec

**System verdict:** SATISFIED
**Grounding issue:** Verdict is SATISFIED but 1 ID-like term(s) did not resolve: ARP4761

**Your call:** Is this verdict correct? If not, run:
```
./run.sh correct R06 not_satisfied --reason "<why>"
```

#### [R08] How do the F-36's HIL test procedures validate SPARTA countermeasures against se

**System verdict:** SATISFIED
**Grounding issue:** Verdict is SATISFIED but 1 ID-like term(s) did not resolve: ARP4761

**Your call:** Is this verdict correct? If not, run:
```
./run.sh correct R08 not_satisfied --reason "<why>"
```

#### [R15] Considering the F-36's use of ARP4761 for safety assessment, what SPARTA attack 

**System verdict:** SATISFIED
**Grounding issue:** Verdict is SATISFIED but 1 ID-like term(s) did not resolve: ARP4761

**Your call:** Is this verdict correct? If not, run:
```
./run.sh correct R15 not_satisfied --reason "<why>"
```

#### [R40] Given the F-36's use of sensor fusion in its flight control system, how do SPART

**System verdict:** SATISFIED
**Grounding issue:** Verdict is SATISFIED but 1 ID-like term(s) did not resolve: ARP4761

**Your call:** Is this verdict correct? If not, run:
```
./run.sh correct R40 not_satisfied --reason "<why>"
```

### Known Errors (5)

These questions were expected to be NOT_SATISFIED but got SATISFIED.

- **[ADV01]** How does SPARTA control X23-MUSTARD mitigate spoofing attacks on the F-36's avio
  - Root cause: grounding_failure
  - Detail: 1 unresolved ID-like terms: X23-MUSTARD
  - Unresolved: `X23-MUSTARD`

- **[ADV10]** How does countermeasure ZZ-PHANTOM-7 in the SPRATA framework protect against adv
  - Root cause: grounding_failure
  - Detail: 1 unresolved ID-like terms: ZZ-PHANTOM-7
  - Unresolved: `ZZ-PHANTOM-7`

- **[ADV03]** How does the SPRTA framework address threats to the F-36's hyperloop propulsion 
  - Root cause: false_positive
  - Detail: Expected not_satisfied but got satisfied with no grounding signal

- **[ADV05]** How do SPARTA countermeasures for T9999.999 prevent the F-36's coffee machine fr
  - Root cause: false_positive
  - Detail: Expected not_satisfied but got satisfied with no grounding signal

- **[ADV06]** What CMMC Level 7 requirements apply to the F-36's neural interface pilot helmet
  - Root cause: false_positive
  - Detail: Expected not_satisfied but got satisfied with no grounding signal

## Summary

| Metric | Value |
|--------|-------|
| Total questions | 50 |
| Correct | 39 |
| Needs human review | **11** |
| Grounding warnings | 4 |
| False positives | 3 |
| Grounding failures | 2 |
| False negatives | 2 |
| Technique scatter | 0 |
| FP rate | 10.0% |
| FN rate | 4.0% |

## All Results

| # | ID | Question | Expected | Actual | Grounding | Status |
|---|-----|----------|----------|--------|-----------|--------|
| 1 | R01 | How should we balance ITAR restrictions with  | satisfied | satisfied | 19R/0U | OK |
| 2 | R02 | What's the appropriate balance between MC/DC  | satisfied | satisfied | 12R/0U | OK |
| 3 | R03 | What SPARTA countermeasures protect the F-36' | satisfied | satisfied | 15R/0U | OK |
| 4 | R04 | What SPARTA countermeasures are recommended t | satisfied | satisfied | 17R/0U | OK |
| 5 | R05 | What MC/DC coverage requirements apply to the | satisfied | satisfied | 15R/0U | OK |
| 6 | R06 | Which SPARTA threats are most relevant to the | satisfied | satisfied | 20R/1U | OK |
| 7 | R07 | How do NIST 800-171 requirements for CUI prot | satisfied | satisfied | 21R/0U | OK |
| 8 | R08 | How do the F-36's HIL test procedures validat | satisfied | satisfied | 18R/1U | OK |
| 9 | R09 | What formal verification methods are applied  | satisfied | satisfied | 18R/0U | OK |
| 10 | R10 | What CMMC practices are integrated into the S | satisfied | satisfied | 20R/0U | OK |
| 11 | R11 | Which SPARTA countermeasures ensure requireme | satisfied | satisfied | 14R/0U | OK |
| 12 | R12 | How can we apply FedRAMP-approved cloud secur | satisfied | satisfied | 23R/0U | OK |
| 13 | R13 | Given the F-36's dual-engine FADEC system's r | satisfied | satisfied | 22R/0U | OK |
| 14 | R14 | How should we apply formal verification techn | satisfied | satisfied | 21R/0U | OK |
| 15 | R15 | Considering the F-36's use of ARP4761 for saf | satisfied | satisfied | 27R/1U | OK |
| 16 | R16 | Considering ITAR restrictions on the F-36's s | satisfied | satisfied | 22R/0U | OK |
| 17 | R17 | For the F-36's C4ISR data fusion module, how  | satisfied | satisfied | 30R/0U | OK |
| 18 | R18 | The F-36's dual-redundant engine control syst | satisfied | satisfied | 25R/0U | OK |
| 19 | R19 | Given the F-36's reliance on third-party vend | satisfied | satisfied | 22R/0U | OK |
| 20 | R20 | Given the F-36's dual-engine architecture and | satisfied | satisfied | 26R/0U | OK |
| 21 | R21 | For the F-36's SCADA-controlled fuel manageme | satisfied | inconclusive | 25R/0U | MISMATCH |
| 22 | R22 | Given the F-36's dual-engine FADEC system's r | satisfied | satisfied | 27R/0U | OK |
| 23 | R23 | How would you evaluate SPARTA's firmware inte | satisfied | inconclusive | 24R/0U | MISMATCH |
| 24 | R24 | What SPARTA threats should we prioritize for  | satisfied | satisfied | 26R/0U | OK |
| 25 | R25 | How should DISA STIG configurations be applie | satisfied | satisfied | 25R/0U | OK |
| 26 | R26 | Given the F-36's reliance on third-party vend | satisfied | satisfied | 27R/0U | OK |
| 27 | R27 | What SPARTA firmware exploit techniques pose  | satisfied | satisfied | 17R/0U | OK |
| 28 | R28 | Given the F-36's use of MISRA C guidelines fo | satisfied | satisfied | 23R/0U | OK |
| 29 | R29 | How do DISA STIG requirements for network seg | satisfied | satisfied | 23R/0U | OK |
| 30 | R30 | How should we adapt CMMC Level 3 practices fo | satisfied | satisfied | 24R/0U | OK |
| 31 | R31 | For the F-36's navigation system, which relie | satisfied | satisfied | 26R/0U | OK |
| 32 | R32 | How does the F-36's dual-engine FADEC system  | satisfied | satisfied | 27R/0U | OK |
| 33 | R33 | Given the F-36's dual-engine architecture and | satisfied | satisfied | 20R/0U | OK |
| 34 | R34 | Given the ITAR restrictions on the F-36's C4I | satisfied | satisfied | 19R/0U | OK |
| 35 | R35 | Given the F-36's reliance on third-party vend | satisfied | satisfied | 22R/0U | OK |
| 36 | R36 | How does the F-36's use of commercial off-the | satisfied | satisfied | 21R/0U | OK |
| 37 | R37 | How should we align the F-36's formal verific | satisfied | satisfied | 23R/0U | OK |
| 38 | R38 | How can we align the F-36's requirements trac | satisfied | satisfied | 21R/0U | OK |
| 39 | R39 | How does the F-36's use of space-grade compon | satisfied | satisfied | 16R/0U | OK |
| 40 | R40 | Given the F-36's use of sensor fusion in its  | satisfied | satisfied | 27R/1U | OK |
| 41 | ADV01 | How does SPARTA control X23-MUSTARD mitigate  | not_satisfied | satisfied | 15R/1U | **WARNING** |
| 42 | ADV02 | What countermesures does CM0028 provide for t | inconclusive | satisfied | 14R/0U | MISMATCH |
| 43 | ADV03 | How does the SPRTA framework address threats  | not_satisfied | satisfied | 11R/0U | MISMATCH |
| 44 | ADV04 | Which NIST 800-53 controls protect the F-36's | inconclusive | satisfied | 10R/0U | MISMATCH |
| 45 | ADV05 | How do SPARTA countermeasures for T9999.999 p | not_satisfied | satisfied | 16R/0U | MISMATCH |
| 46 | ADV06 | What CMMC Level 7 requirements apply to the F | not_satisfied | satisfied | 12R/0U | MISMATCH |
| 47 | ADV07 | Compare ESA-T2031 firmware protection with CM | inconclusive | satisfied | 17R/0U | MISMATCH |
| 48 | ADV08 | How does the F-36 use Kerberos ticket-grantin | inconclusive | satisfied | 16R/0U | MISMATCH |
| 49 | ADV09 | What SPARTA defenses protect the F-36's Windo | inconclusive | satisfied | 21R/0U | MISMATCH |
| 50 | ADV10 | How does countermeasure ZZ-PHANTOM-7 in the S | not_satisfied | satisfied | 17R/1U | **WARNING** |

## False Negatives

Questions expected to be SATISFIED but got a different verdict.

- **[R21]** For the F-36's SCADA-controlled fuel management system, which SPARTA threats inv — got inconclusive
- **[R23]** How would you evaluate SPARTA's firmware integrity verification techniques again — got inconclusive
