# Scientific Disclaimer

## Simulation Accuracy Notice

This software ("Orbital Sentinel") is provided for **educational and research purposes only**. 
The simulation results, orbital predictions, and impact assessments are **approximations** 
based on simplified physical models and may not accurately represent real-world outcomes.

### Key Limitations

1. **Orbital Elements**: Asteroid orbital data from NASA NeoWs API may have uncertainties 
   ranging from meters to kilometers depending on observation history.

2. **Physics Model**: The simulation implements comprehensive orbital mechanics including:
   - N-body gravity with Moon perturbations for close Earth approaches
   - J2 oblateness perturbation
   - Solar Radiation Pressure
   - Yarkovsky thermal effect
   - Jupiter/Mars gravitational perturbations
   
   **However, it does not include:**
   - Non-gravitational outgassing
   - Binary asteroid interactions  
   - General relativistic effects (except simplified precession)
   - Precise thermal modeling

3. **MOID Calculation**: Uses 72×72 point orbital sampling for accuracy, but is not JPL-grade precision.

4. **Torino Scale**: Our energy-based Torino classification is a simplified model that:
   - Converts kinetic energy to Megatons TNT
   - Uses probability × energy thresholds
   - Does NOT replace official NASA Sentry or ESA NEOCC assessments

5. **Impact Predictions**: All "hazard" or "impact" assessments are **NOT** official NASA/ESA 
   determinations. For official assessments, consult:
   - [NASA Center for Near Earth Object Studies (CNEOS)](https://cneos.jpl.nasa.gov/)
   - [ESA NEO Coordination Centre (NEOCC)](https://neo.ssa.esa.int/)

### No Liability

THE AUTHORS AND CONTRIBUTORS PROVIDE THIS SOFTWARE "AS IS" WITHOUT WARRANTY OF ANY KIND, 
EXPRESS OR IMPLIED. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES, OR 
OTHER LIABILITY ARISING FROM THE USE OF THIS SOFTWARE.

**This software should NOT be used for:**
- Mission planning or spacecraft operations
- Threat assessment for governmental agencies
- Any safety-critical applications
- Making real-world planetary defense decisions

### Contact for Official Information

For questions about real asteroid threats, contact:
- NASA Planetary Defense Coordination Office (PDCO)
- ESA Space Safety Programme

---

*Last updated: 18.12.2025*
