# Wallet sending animation and savings

Add visible feedback to button-based sends and a compact Savings island directly above the owned token list. Keep the existing dark surfaces and violet accent. The island contains a Savings label, the current USDC APY, and Deposit.

Use the existing `/vaults` endpoint and the highest available USDC APY, matching the backend's default savings selection. Open an amount sheet and propose `earn_deposit` for the displayed vault; the existing confirmation card remains the only execution path. Show unknown rates as unavailable, with retry on load failure.

Animate the token moving outward while confirmation is pending, and a checkmark on successful receipts. Include an animated indicator during proposal preparation. Respect reduced motion and announce progress accessibly. Success is driven by the actual receipt, never a timer.

Approach: lightweight CSS animation and the existing drawers avoid adding a motion dependency. A separate savings dashboard or a decorative deposit button would exceed or underserve the requested compact island.
