import { NavLink } from 'react-router';

import useDocTitle from '../../hooks/use-doc-title';

import Transitions from '../../animations/Transition';

import '../../css/error.css';

import Button from 'react-bootstrap/Button';

const Forbidden = () => {
    useDocTitle('F1 HD | ДОСТУП ЗАПРЕЩЁН');
    return (
        <Transitions>
            <div id='error'>
                <div className='error'>
                    <div className='error-code'>
                        <h1>
                            4<span></span>3
                        </h1>
                    </div>
                    <h2>Упс! Вам сюда нельзя</h2>
                    <p>
                        К сожалению, у вас нет доступа к запрашиваемой странице.
                    </p>
                    <Button as={NavLink} to='/' variant='primary' size='lg'>
                        НА ГЛАВНУЮ
                    </Button>
                </div>
            </div>
        </Transitions>
    );
};

export default Forbidden;
