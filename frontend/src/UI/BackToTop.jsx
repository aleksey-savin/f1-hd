import { useState, useEffect } from "react";
import { isBrowser } from "react-device-detect";

import Button from "react-bootstrap/Button";

import { RiArrowUpLine } from "react-icons/ri";

const BackToTop = () => {
  const [isVisible, setIsVisible] = useState(false);

  // Toggle visibility based on scroll position
  const toggleVisibility = () => {
    if (window.scrollY > 300) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  };

  // Scroll to top when the component is clicked
  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    // Add scroll event listener
    window.addEventListener("scroll", toggleVisibility);

    // Clean up the event listener on component unmount
    return () => {
      window.removeEventListener("scroll", toggleVisibility);
    };
  }, []);

  return (
    <div>
      {isVisible && (
        <Button
          variant="success"
          className="z-3"
          onClick={scrollToTop}
          style={styles.backToTopButton}
        >
          <RiArrowUpLine />
        </Button>
      )}
    </div>
  );
};

// Basic styles for the button
const styles = {
  backToTopButton: {
    position: "fixed",
    bottom: isBrowser ? "1.25rem" : "6.25rem",
    right: "1.25rem",
    width: "3.125rem",
    height: "3.125rem",
    fontSize: "1.5rem",
    borderRadius: "50%",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};

export default BackToTop;
