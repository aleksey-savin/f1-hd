import { useContext } from "react";

import { NavLink } from "react-router";

import Button from "react-bootstrap/Button";
import Navbar from "react-bootstrap/Navbar";

import {
  RiAccountBoxLine,
  RiArchiveLine,
  RiDashboard2Line,
  RiBuilding2Line,
} from "react-icons/ri";

import { TbCheckbox } from "react-icons/tb";

import { AuthedUserContext } from "../store/authed-user-context";

const MobileBottomNavbar = () => {
  const { dashboard, isEndUser } = useContext(AuthedUserContext);

  return (
    <Navbar className="fixed-bottom bg-primary" style={{ zIndex: 1000 }}>
      <div className="container-fluid justify-content-around">
        {dashboard?.isActive && (
          <Button as={NavLink} size="lg" variant="link" replace to="/">
            <RiDashboard2Line />
          </Button>
        )}
        <Button as={NavLink} size="lg" variant="link" replace to="/tickets">
          <TbCheckbox />
        </Button>
        {!isEndUser && (
          <>
            <Button as={NavLink} size="lg" variant="link" replace to="/users">
              <RiAccountBoxLine />
            </Button>
            <Button
              as={NavLink}
              size="lg"
              variant="link"
              replace
              to="/companies"
            >
              <RiBuilding2Line />
            </Button>
          </>
        )}
        {isEndUser && (
          <Button
            as={NavLink}
            size="lg"
            variant="link"
            replace
            to="/closed-tickets"
          >
            <RiArchiveLine />
          </Button>
        )}
      </div>
    </Navbar>
  );
};

export default MobileBottomNavbar;
