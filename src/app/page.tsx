import { HeroSection } from '@/components/home/HeroSection'
import { RentalModeSection } from '@/components/home/RentalModeSection'
import { FeaturedListings } from '@/components/home/FeaturedListings'
import { TrustSection } from '@/components/home/TrustSection'
import { HowItWorksPreview } from '@/components/home/HowItWorksPreview'
import { RegionsSection } from '@/components/home/RegionsSection'
import { HostCTASection } from '@/components/home/HostCTASection'

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <RentalModeSection />
      <FeaturedListings />
      <TrustSection />
      <HowItWorksPreview />
      <RegionsSection />
      <HostCTASection />
    </>
  )
}
